/* ====== FINANCIAL DASHBOARD - SCRIPT PRINCIPAL ====== */
/* API Key: 9U9WSSGC22S3QQA1 (Alpha Vantage) */

// ==================== CONFIGURAÇÕES E VARIÁVEIS GLOBAIS ====================
const CONFIG = {
    API_KEY: '9U9WSSGC22S3QQA1',
    API_BASE_URL: 'https://www.alphavantage.co/query',
    DEFAULT_SYMBOLS: ['PETR4.SA', 'AAPL', 'BTCUSD'], // Símbolos iniciais
    UPDATE_INTERVAL: 60000, // 60 segundos (em produção seria 1-5 minutos)
    MAX_REQUESTS_PER_DAY: 25 // Limite da API gratuita
};

// Estado da aplicação
let state = {
    stocks: [], // Array de objetos {symbol, data, lastUpdated}
    isUpdating: false,
    lastUpdateTime: null
};

// Elementos DOM
const DOM = {
    stockInput: document.getElementById('stock-input'),
    addButton: document.getElementById('add-stock'),
    stocksContainer: document.getElementById('stocks-container'),
    refreshAllButton: document.getElementById('refresh-all'),
    updateTimeElement: document.getElementById('update-time'),
    totalAssetsElement: document.getElementById('total-assets'),
    dailyChangeElement: document.getElementById('daily-change'),
    totalValueElement: document.getElementById('total-value')
};

// ==================== FUNÇÕES DE ESTADO/LOCALSTORAGE ====================

/**
 * Carrega as ações salvas no localStorage
 */
function loadStocksFromStorage() {
    const savedStocks = localStorage.getItem('finDash_stocks');
    if (savedStocks) {
        try {
            state.stocks = JSON.parse(savedStocks);
            console.log(`Carregadas ${state.stocks.length} ações do localStorage`);
        } catch (error) {
            console.error('Erro ao carregar dados do localStorage:', error);
            state.stocks = [];
        }
    } else {
        // Usar símbolos padrão se não houver dados salvos
        state.stocks = CONFIG.DEFAULT_SYMBOLS.map(symbol => ({
            symbol: symbol,
            data: null,
            lastUpdated: null
        }));
    }
}

/**
 * Salva as ações no localStorage
 */
function saveStocksToStorage() {
    try {
        localStorage.setItem('finDash_stocks', JSON.stringify(state.stocks));
        console.log('Ações salvas no localStorage');
    } catch (error) {
        console.error('Erro ao salvar no localStorage:', error);
    }
}

/**
 * Adiciona uma nova ação ao estado
 */
function addStockToState(symbol) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    
    // Validar símbolo
    if (!normalizedSymbol) {
        showNotification('Digite um símbolo válido', 'error');
        return false;
    }
    
    // Verificar se já existe
    if (state.stocks.some(stock => stock.symbol === normalizedSymbol)) {
        showNotification(`${normalizedSymbol} já está na sua lista`, 'warning');
        return false;
    }
    
    // Adicionar ao estado
    state.stocks.push({
        symbol: normalizedSymbol,
        data: null,
        lastUpdated: null
    });
    
    console.log(`Ação ${normalizedSymbol} adicionada ao estado`);
    saveStocksToStorage();
    return true;
}

/**
 * Remove uma ação do estado
 */
function removeStockFromState(symbol) {
    const initialLength = state.stocks.length;
    state.stocks = state.stocks.filter(stock => stock.symbol !== symbol);
    
    if (state.stocks.length < initialLength) {
        saveStocksToStorage();
        console.log(`Ação ${symbol} removida do estado`);
        return true;
    }
    return false;
}

// ==================== FUNÇÕES DE API ====================

/**
 * Busca dados de uma ação na Alpha Vantage API
 */
async function fetchStockData(symbol) {
    console.log(`Buscando dados para: ${symbol}`);
    
    // Mostrar estado de carregamento
    updateStockCard(symbol, { isLoading: true });
    
    try {
        // Construir URL da API
        const url = new URL(CONFIG.API_BASE_URL);
        url.searchParams.append('function', 'GLOBAL_QUOTE');
        url.searchParams.append('symbol', symbol);
        url.searchParams.append('apikey', CONFIG.API_KEY);
        
        // Fazer a requisição
        const response = await fetch(url.toString());
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // Verificar erros da API
        if (data['Error Message']) {
            throw new Error(data['Error Message']);
        }
        
        if (data['Note']) {
            console.warn('Limite da API atingido:', data['Note']);
            showNotification('Limite de requisições diário atingido', 'warning');
            return null;
        }
        
        // Extrair dados relevantes
        const quote = data['Global Quote'];
        if (!quote || !quote['01. symbol']) {
            throw new Error('Dados da ação não encontrados');
        }
        
        // Formatar os dados
        const stockData = {
            symbol: quote['01. symbol'],
            price: parseFloat(quote['05. price']),
            change: parseFloat(quote['09. change']),
            changePercent: quote['10. change percent'].replace('%', ''),
            open: parseFloat(quote['02. open']),
            high: parseFloat(quote['03. high']),
            low: parseFloat(quote['04. low']),
            volume: parseInt(quote['06. volume']),
            latestTradingDay: quote['07. latest trading day']
        };
        
        console.log(`Dados recebidos para ${symbol}:`, stockData);
        return stockData;
        
    } catch (error) {
        console.error(`Erro ao buscar dados para ${symbol}:`, error);
        showNotification(`Erro ao buscar ${symbol}: ${error.message}`, 'error');
        return null;
    }
}

/**
 * Busca dados para todas as ações
 */
async function fetchAllStocksData() {
    if (state.isUpdating) {
        console.log('Atualização já em andamento');
        return;
    }
    
    state.isUpdating = true;
    updateUpdateTime();
    
    console.log(`Iniciando atualização de ${state.stocks.length} ações`);
    
    // Atualizar uma ação por vez para respeitar a API
    for (let i = 0; i < state.stocks.length; i++) {
        const stock = state.stocks[i];
        const stockData = await fetchStockData(stock.symbol);
        
        if (stockData) {
            // Atualizar no estado
            stock.data = stockData;
            stock.lastUpdated = new Date().toISOString();
            
            // Atualizar no DOM
            updateStockCard(stock.symbol, stockData);
        }
        
        // Pequena pausa entre requisições
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    state.isUpdating = false;
    saveStocksToStorage();
    updatePortfolioSummary();
    console.log('Atualização completa');
}

// ==================== FUNÇÕES DE RENDERIZAÇÃO ====================

/**
 * Atualiza ou cria um card de ação
 */
function updateStockCard(symbol, data) {
    const cardId = `stock-${symbol}`;
    let cardElement = document.getElementById(cardId);
    
    // Se o card não existe, criar um novo
    if (!cardElement) {
        if (data.isLoading) return; // Não criar card apenas para loading
        
        cardElement = createStockCard(symbol);
        DOM.stocksContainer.prepend(cardElement);
    }
    
    // Se está carregando
    if (data.isLoading) {
        cardElement.classList.add('loading');
        cardElement.querySelector('.price').textContent = 'Carregando...';
        return;
    }
    
    cardElement.classList.remove('loading');
    
    // Atualizar dados
    const change = parseFloat(data.change);
    const changePercent = parseFloat(data.changePercent);
    
    // Elementos do card
    cardElement.querySelector('.stock-symbol').textContent = symbol;
    cardElement.querySelector('.price').textContent = formatCurrency(data.price);
    cardElement.querySelector('.change').textContent = 
        `${change >= 0 ? '+' : ''}${formatNumber(change)} (${changePercent.toFixed(2)}%)`;
    
    // Atualizar classes de cor
    const changeElement = cardElement.querySelector('.change');
    const indicatorIcon = cardElement.querySelector('.indicator-icon');
    
    changeElement.className = 'change ' + (change >= 0 ? 'positive' : 'negative');
    indicatorIcon.textContent = change >= 0 ? '↗' : '↘';
    indicatorIcon.style.color = change >= 0 ? 'var(--positive-color)' : 'var(--negative-color)';
    
    // Atualizar detalhes
    cardElement.querySelector('.open-price').textContent = formatCurrency(data.open);
    cardElement.querySelector('.high-price').textContent = formatCurrency(data.high);
    cardElement.querySelector('.low-price').textContent = formatCurrency(data.low);
    cardElement.querySelector('.volume').textContent = formatNumber(data.volume);
    
    // Atualizar timestamp
    const now = new Date();
    cardElement.querySelector('.last-updated').textContent = 
        `Atualizado: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * Cria um novo elemento card a partir do template
 */
function createStockCard(symbol) {
    const template = document.getElementById('stock-card-template');
    const clone = template.content.cloneNode(true);
    const cardElement = clone.querySelector('.stock-card');
    
    // Configurar elemento
    cardElement.id = `stock-${symbol}`;
    cardElement.setAttribute('data-symbol', symbol);
    
    // Configurar botão de remover
    const removeButton = cardElement.querySelector('.btn-remove');
    removeButton.addEventListener('click', () => {
        if (removeStockFromState(symbol)) {
            cardElement.remove();
            updatePortfolioSummary();
            showNotification(`${symbol} removido`, 'info');
        }
    });
    
    // Configurar botão de atualizar
    const updateButton = cardElement.querySelector('.btn-update');
    updateButton.addEventListener('click', () => {
        fetchStockData(symbol).then(data => {
            if (data) {
                const stock = state.stocks.find(s => s.symbol === symbol);
                if (stock) {
                    stock.data = data;
                    stock.lastUpdated = new Date().toISOString();
                    updateStockCard(symbol, data);
                    updatePortfolioSummary();
                }
            }
        });
    });
    
    return cardElement;
}

/**
 * Atualiza o resumo do portfólio
 */
function updatePortfolioSummary() {
    const validStocks = state.stocks.filter(stock => stock.data);
    
    // Atualizar contagem
    DOM.totalAssetsElement.textContent = validStocks.length;
    
    if (validStocks.length === 0) {
        DOM.dailyChangeElement.textContent = '0.00%';
        DOM.dailyChangeElement.className = 'value neutral';
        DOM.totalValueElement.textContent = 'R$ 0,00';
        return;
    }
    
    // Calcular totais
    let totalValue = 0;
    let totalChangePercent = 0;
    
    validStocks.forEach(stock => {
        totalValue += stock.data.price;
        totalChangePercent += parseFloat(stock.data.changePercent);
    });
    
    const avgChangePercent = totalChangePercent / validStocks.length;
    
    // Atualizar DOM
    DOM.totalValueElement.textContent = formatCurrency(totalValue);
    DOM.dailyChangeElement.textContent = `${avgChangePercent >= 0 ? '+' : ''}${avgChangePercent.toFixed(2)}%`;
    DOM.dailyChangeElement.className = `value ${avgChangePercent >= 0 ? 'positive' : 'negative'}`;
}

/**
 * Atualiza o tempo da última atualização
 */
function updateUpdateTime() {
    const now = new Date();
    const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    DOM.updateTimeElement.textContent = timeString;
    state.lastUpdateTime = now;
}

// ==================== FUNÇÕES UTILITÁRIAS ====================

/**
 * Formata número como moeda brasileira
 */
function formatCurrency(value) {
    if (typeof value !== 'number') return 'R$ --,--';
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

/**
 * Formata número com separadores de milhar
 */
function formatNumber(value) {
    if (typeof value !== 'number') return '--';
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

/**
 * Mostra notificação temporária
 */
function showNotification(message, type = 'info') {
    // Remover notificação anterior
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Criar nova notificação
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 24px;
        background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#10b981'};
        color: white;
        border-radius: 8px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    // Remover após 3 segundos
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, 3000);
}

/**
 * Limpa o estado de carregamento de todos os cards
 */
function clearLoadingStates() {
    document.querySelectorAll('.stock-card.loading').forEach(card => {
        card.classList.remove('loading');
    });
}

// ==================== INICIALIZAÇÃO ====================

/**
 * Configura todos os event listeners
 */
function setupEventListeners() {
    // Adicionar ação
    DOM.addButton.addEventListener('click', () => {
        const symbol = DOM.stockInput.value;
        if (addStockToState(symbol)) {
            DOM.stockInput.value = '';
            fetchStockData(symbol);
            updatePortfolioSummary();
        }
    });
    
    // Enter no input
    DOM.stockInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            DOM.addButton.click();
        }
    });
    
    // Atualizar tudo
    DOM.refreshAllButton.addEventListener('click', () => {
        fetchAllStocksData();
    });
    
    // Input examples click
    DOM.stockInput.addEventListener('focus', () => {
        if (!DOM.stockInput.value) {
            DOM.stockInput.placeholder = 'Ex: PETR4.SA, AAPL, BTCUSD, MSFT, GOOGL';
        }
    });
}

/**
 * Inicializa a aplicação
 */
async function initializeApp() {
    console.log('Inicializando FinDash...');
    
    // 1. Carregar estado
    loadStocksFromStorage();
    
    // 2. Configurar eventos
    setupEventListeners();
    
    // 3. Renderizar estado inicial
    updatePortfolioSummary();
    updateUpdateTime();
    
    // 4. Buscar dados iniciais (apenas para 1-2 ações para economizar API)
    const stocksToFetch = state.stocks.slice(0, 2); // Limitar a 2 requisições iniciais
    for (const stock of stocksToFetch) {
        const data = await fetchStockData(stock.symbol);
        if (data) {
            stock.data = data;
            stock.lastUpdated = new Date().toISOString();
            updateStockCard(stock.symbol, data);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 5. Atualizar resumo
    updatePortfolioSummary();
    
    // 6. Configurar atualização automática
    setInterval(() => {
        if (state.stocks.length > 0 && !state.isUpdating) {
            fetchAllStocksData();
        }
    }, CONFIG.UPDATE_INTERVAL);
    
    console.log('FinDash inicializado com sucesso!');
}

// ==================== ESTILOS DINÂMICOS ====================

/**
 * Adiciona estilos CSS dinâmicos
 */
function addDynamicStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .stock-card.loading {
            opacity: 0.7;
            position: relative;
        }
        
        .stock-card.loading::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
            animation: loadingShimmer 1.5s infinite;
        }
        
        @keyframes loadingShimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        
        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(100%); opacity: 0; }
        }
        
        .change.positive {
            color: var(--positive-color);
            font-weight: 600;
        }
        
        .change.negative {
            color: var(--negative-color);
            font-weight: 600;
        }
    `;
    document.head.appendChild(style);
}

// ==================== EXECUÇÃO ====================

// Quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', () => {
    addDynamicStyles();
    initializeApp().catch(error => {
        console.error('Erro na inicialização:', error);
        showNotification('Erro ao inicializar o dashboard', 'error');
    });
});

// Para debug no console
window.finDash = {
    state: () => state,
    refresh: () => fetchAllStocksData(),
    addStock: (symbol) => {
        if (addStockToState(symbol)) {
            fetchStockData(symbol);
            updatePortfolioSummary();
        }
    },
    clearStorage: () => {
        localStorage.removeItem('finDash_stocks');
        location.reload();
    }
};