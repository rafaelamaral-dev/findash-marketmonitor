/* ====== FINANCIAL DASHBOARD - SCRIPT COMPLETO COM CHART.JS ====== */

// ==================== CONFIGURAÇÕES E VARIÁVEIS GLOBAIS ====================
const CONFIG = {
    API_KEY: '9U9WSSGC22S3QQA1',
    API_BASE_URL: 'https://www.alphavantage.co/query',
    DEFAULT_SYMBOLS: ['PETR4.SA', 'AAPL', 'BTCUSD'],
    UPDATE_INTERVAL: 60000, // 1 minuto para economizar requisições
    MAX_REQUESTS_PER_DAY: 25
};

// Estado da aplicação
let state = {
    stocks: [],
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
        state.stocks = CONFIG.DEFAULT_SYMBOLS.map(symbol => ({
            symbol: symbol,
            data: null,
            lastUpdated: null,
            history: null
        }));
    }
}

function saveStocksToStorage() {
    try {
        localStorage.setItem('finDash_stocks', JSON.stringify(state.stocks));
    } catch (error) {
        console.error('Erro ao salvar no localStorage:', error);
    }
}

function addStockToState(symbol) {
    const normalizedSymbol = symbol.trim().toUpperCase();
    
    if (!normalizedSymbol) {
        showNotification('Digite um símbolo válido', 'error');
        return false;
    }
    
    if (state.stocks.some(stock => stock.symbol === normalizedSymbol)) {
        showNotification(`${normalizedSymbol} já está na sua lista`, 'warning');
        return false;
    }
    
    state.stocks.push({
        symbol: normalizedSymbol,
        data: null,
        history: null,
        lastUpdated: null
    });
    
    saveStocksToStorage();
    return true;
}

function removeStockFromState(symbol) {
    const initialLength = state.stocks.length;
    state.stocks = state.stocks.filter(stock => stock.symbol !== symbol);
    
    if (state.stocks.length < initialLength) {
        saveStocksToStorage();
        return true;
    }
    return false;
}

// ==================== FUNÇÕES DE API ====================

async function fetchStockData(symbol) {
    console.log(`Buscando dados para: ${symbol}`);
    
    updateStockCard(symbol, { isLoading: true });
    
    try {
        const url = new URL(CONFIG.API_BASE_URL);
        url.searchParams.append('function', 'GLOBAL_QUOTE');
        url.searchParams.append('symbol', symbol);
        url.searchParams.append('apikey', CONFIG.API_KEY);
        
        const response = await fetch(url.toString());
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data['Error Message']) {
            throw new Error(data['Error Message']);
        }
        
        if (data['Note']) {
            console.warn('Limite da API atingido:', data['Note']);
            showNotification('Limite de requisições diário atingido', 'warning');
            return null;
        }
        
        const quote = data['Global Quote'];
        if (!quote || !quote['01. symbol']) {
            throw new Error('Dados da ação não encontrados');
        }
        
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
        
        return stockData;
        
    } catch (error) {
        console.error(`Erro ao buscar dados para ${symbol}:`, error);
        showNotification(`Erro ao buscar ${symbol}: ${error.message}`, 'error');
        return null;
    }
}

async function fetchStockHistory(symbol) {
    console.log(`[DEBUG] Buscando histórico para: ${symbol}`);
    
    try {
        // URL da API de histórico (CORRIGIDA)
        const url = new URL(CONFIG.API_BASE_URL);
        url.searchParams.append('function', 'TIME_SERIES_DAILY');
        url.searchParams.append('symbol', symbol);
        url.searchParams.append('apikey', CONFIG.API_KEY);
        // REMOVA outputsize se estiver causando problemas
        // url.searchParams.append('outputsize', 'compact');

        console.log(`[DEBUG] URL da API: ${url.toString()}`);
        
        const response = await fetch(url.toString());
        
        if (!response.ok) {
            console.warn(`Resposta HTTP não OK: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`[DEBUG] Dados brutos recebidos:`, data);

        // Verificar erros da API Alpha Vantage
        if (data['Error Message']) {
            console.warn(`API retornou erro: ${data['Error Message']}`);
            return null;
        }
        
        if (data['Note']) {
            console.warn('Limite da API atingido:', data['Note']);
            showNotification('Limite de requisições diário atingido', 'warning');
            return null;
        }

        // A chave correta é 'Time Series (Daily)' (com espaço)
        const timeSeries = data['Time Series (Daily)'];
        if (!timeSeries) {
            console.warn(`Nenhuma série temporal encontrada para ${symbol}. Dados disponíveis:`, Object.keys(data));
            
            // Tentar alternativa: talvez seja 'Weekly Time Series'
            const weeklySeries = data['Weekly Time Series'];
            if (weeklySeries) {
                console.log(`[DEBUG] Usando dados semanais para ${symbol}`);
                return processHistoryData(weeklySeries, 8); // 8 semanas
            }
            
            return null;
        }

        return processHistoryData(timeSeries, 15);

    } catch (error) {
        console.error(`Erro ao buscar histórico para ${symbol}:`, error);
        return null;
    }
}

// Função auxiliar para processar dados históricos
function processHistoryData(timeSeries, daysLimit) {
    const history = Object.entries(timeSeries)
        .map(([date, values]) => ({
            date: date,
            close: parseFloat(values['4. close']) || 0
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .slice(-daysLimit); // Últimos X dias/semanas
    
    console.log(`[DEBUG] Histórico processado: ${history.length} pontos`);
    return history.length > 0 ? history : null;
}

async function updateStockWithChart(symbol) {
    const stockData = await fetchStockData(symbol);
    
    if (stockData) {
        let history = await fetchStockHistory(symbol);
        
        // SE não conseguir dados históricos, criar dados simulados baseados no preço atual
        if (!history || history.length === 0) {
            console.log(`[DEBUG] Criando dados simulados para gráfico de ${symbol}`);
            history = generateMockHistory(stockData.price, 10);
        }
        
        const stockIndex = state.stocks.findIndex(s => s.symbol === symbol);
        if (stockIndex !== -1) {
            state.stocks[stockIndex].data = stockData;
            state.stocks[stockIndex].history = history;
            state.stocks[stockIndex].lastUpdated = new Date().toISOString();
            
            updateStockCard(symbol, stockData, history);
        }
        
        return true;
    }
    
    return false;
}

// Função para gerar dados de histórico simulados
function generateMockHistory(currentPrice, days) {
    const history = [];
    let basePrice = currentPrice * 0.9; // Começar 10% abaixo
    
    for (let i = 0; i < days; i++) {
        const date = new Date();
        date.setDate(date.getDate() - (days - i - 1));
        
        // Variação aleatória de ±3%
        const variation = (Math.random() * 6 - 3) / 100;
        basePrice = basePrice * (1 + variation);
        
        history.push({
            date: date.toISOString().split('T')[0], // Formato YYYY-MM-DD
            close: basePrice
        });
    }
    
    console.log(`[DEBUG] Dados simulados gerados: ${history.length} dias`);
    return history;
}

async function fetchAllStocksData() {
    if (state.isUpdating) {
        console.log('Atualização já em andamento');
        return;
    }
    
    state.isUpdating = true;
    updateUpdateTime();
    
    console.log(`Iniciando atualização de ${state.stocks.length} ações`);
    
    for (let i = 0; i < state.stocks.length; i++) {
        const stock = state.stocks[i];
        await updateStockWithChart(stock.symbol);
        
        // Pausa para respeitar limite da API
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    
    state.isUpdating = false;
    saveStocksToStorage();
    updatePortfolioSummary();
    console.log('Atualização completa');
}

// ==================== FUNÇÕES DO CHART.JS ====================

function createStockChart(containerElement, history, isPositive) {
    console.log(`[DEBUG-GRÁFICO] Iniciando criação para container:`, containerElement);
    
    // 1. Verificar se já existe um gráfico neste container e destruí-lo
    if (containerElement._chartInstance) {
        console.log(`[DEBUG-GRÁFICO] Destruindo gráfico anterior no container`);
        containerElement._chartInstance.destroy();
        containerElement._chartInstance = null;
    }
    
    // 2. Criar canvas se não existir
    let canvas = containerElement.querySelector('canvas');
    if (!canvas) {
        console.log(`[DEBUG-GRÁFICO] Criando novo canvas`);
        canvas = document.createElement('canvas');
        containerElement.innerHTML = '';
        containerElement.appendChild(canvas);
    }
    
    // 3. Garantir que o canvas tenha as dimensões corretas
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    
    // 4. Preparar dados para o gráfico (SIMPLIFICADO PARA TESTE)
    const labels = [];
    const data = [];
    
    // Usar apenas os últimos 7 pontos para ficar mais legível
    const recentHistory = history.slice(-7);
    
    recentHistory.forEach((item, index) => {
        // Formatar data como "Dia/Mês"
        const date = new Date(item.date);
        labels.push(`${date.getDate()}/${date.getMonth() + 1}`);
        data.push(item.close);
    });
    
    console.log(`[DEBUG-GRÁFICO] Dados preparados: ${labels.length} pontos`);
    
    // 5. Configuração SIMPLIFICADA do gráfico
    const config = {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Preço',
                data: data,
                borderColor: isPositive ? '#10b981' : '#ef4444',
                backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.2,
                pointRadius: 3,
                pointBackgroundColor: isPositive ? '#10b981' : '#ef4444'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `R$ ${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    display: true,
                    ticks: {
                        maxTicksLimit: 5,
                        font: {
                            size: 10
                        }
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    display: false,
                    beginAtZero: false
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            }
        }
    };
    
    // 6. Criar a instância do gráfico e armazenar referência
    try {
        console.log(`[DEBUG-GRÁFICO] Instanciando Chart.js`);
        const chartInstance = new Chart(canvas, config);
        
        // Armazenar a referência NO PRÓPRIO CONTAINER
        containerElement._chartInstance = chartInstance;
        
        console.log(`[DEBUG-GRÁFICO] Gráfico criado com sucesso!`);
        return chartInstance;
    } catch (error) {
        console.error(`[DEBUG-GRÁFICO] Erro ao criar gráfico:`, error);
        return null;
    }
}

// ==================== FUNÇÕES DE RENDERIZAÇÃO ====================

function updateStockCard(symbol, stockData, history = null) {
    console.log(`[DEBUG] updateStockCard chamada para ${symbol}`, { stockData, history });

    const cardId = `stock-${symbol}`;
    let cardElement = document.getElementById(cardId);

    // 1. Criar o card se não existir
    if (!cardElement && stockData && !stockData.isLoading) {
        cardElement = createStockCardElement(symbol);
        DOM.stocksContainer.prepend(cardElement);
        console.log(`[DEBUG] Card criado para ${symbol}`);
    }

    if (!cardElement) return;

    // 2. Estado de Carregamento
    if (stockData && stockData.isLoading) {
        cardElement.classList.add('loading');
        cardElement.querySelector('.price').textContent = 'Carregando...';
        return;
    }
    cardElement.classList.remove('loading');

    // 3. Preencher dados básicos (se houver)
    if (stockData) {
        const change = parseFloat(stockData.change);
        const changePercent = parseFloat(stockData.changePercent);
        const isPositive = change >= 0;

        cardElement.querySelector('.stock-symbol').textContent = symbol;
        cardElement.querySelector('.price').textContent = formatCurrency(stockData.price);

        const changeElement = cardElement.querySelector('.change');
        changeElement.textContent = `${isPositive ? '+' : ''}${formatNumber(change)} (${changePercent.toFixed(2)}%)`;
        changeElement.className = 'change ' + (isPositive ? 'positive' : 'negative');

        cardElement.querySelector('.open-price').textContent = formatCurrency(stockData.open);
        cardElement.querySelector('.high-price').textContent = formatCurrency(stockData.high);
        cardElement.querySelector('.low-price').textContent = formatCurrency(stockData.low);
        cardElement.querySelector('.volume').textContent = formatNumber(stockData.volume);

        const now = new Date();
        cardElement.querySelector('.last-updated').textContent = 
            `Atualizado: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }

    // 4. LÓGICA DO GRÁFICO (PARTE CRÍTICA)
    const chartContainer = cardElement.querySelector('.chart-container');
    if (!chartContainer) {
        console.error(`[DEBUG] Container do gráfico NÃO ENCONTRADO no card de ${symbol}!`);
        return;
    }

    if (history && history.length > 0) {
    console.log(`[DEBUG] Criando gráfico para ${symbol} com ${history.length} pontos.`);
    
    // Garantir que temos o container correto
    let chartContainer = cardElement.querySelector('.chart-container');
    
    if (!chartContainer) {
        console.warn(`[DEBUG] Container do gráfico não encontrado, criando novo...`);
        chartContainer = document.createElement('div');
        chartContainer.className = 'chart-container';
        chartContainer.style.cssText = 'height: 120px; margin: 1rem 0; position: relative;';
        cardElement.querySelector('.card-body').appendChild(chartContainer);
    }
    
    // Criar o gráfico
    createStockChart(chartContainer, history, stockData ? (parseFloat(stockData.change) >= 0) : true);
} else {
        console.warn(`[DEBUG] Sem dados históricos para ${symbol} ou array vazio.`);
        chartContainer.innerHTML = '<p class="no-chart-data">Dados históricos não disponíveis para este ativo.</p>';
    }
}

function createStockCardElement(symbol) {
    console.log(`[DEBUG] Criando elemento do card para ${symbol}`);
    
    // 1. Obter o template do HTML
    const template = document.getElementById('stock-card-template');
    if (!template) {
        console.error('[DEBUG] Template do card não encontrado no HTML!');
        return null;
    }

    // 2. Clonar o conteúdo do template
    const clone = template.content.cloneNode(true);
    const cardElement = clone.querySelector('.stock-card');
    if (!cardElement) {
        console.error('[DEBUG] Elemento .stock-card não encontrado no template!');
        return null;
    }

    // 3. Configurar atributos básicos do card
    cardElement.id = `stock-${symbol}`;
    cardElement.setAttribute('data-symbol', symbol);

    // 4. Configurar o container do gráfico (CRÍTICO)
    // Encontra o placeholder e muda para a classe correta
    const chartPlaceholder = cardElement.querySelector('.chart-placeholder');
    if (chartPlaceholder) {
        chartPlaceholder.className = 'chart-container'; // Altera a classe
        // chartPlaceholder.innerHTML = ''; // Limpa o conteúdo, o canvas será criado depois
    } else {
        console.warn(`[DEBUG] Elemento .chart-placeholder não encontrado no card de ${symbol}. Verifique o HTML.`);
    }

    // 5. Configurar o botão de remover
    const removeButton = cardElement.querySelector('.btn-remove');
    if (removeButton) {
        removeButton.addEventListener('click', () => {
            if (removeStockFromState(symbol)) {
                cardElement.remove();
                updatePortfolioSummary();
                showNotification(`${symbol} removido`, 'info');
            }
        });
    }

    // 6. Configurar o botão de atualizar
    const updateButton = cardElement.querySelector('.btn-update');
    if (updateButton) {
        updateButton.addEventListener('click', async () => {
            const success = await updateStockWithChart(symbol);
            if (success) {
                updatePortfolioSummary();
                showNotification(`${symbol} atualizado`, 'success');
            }
        });
    }

    console.log(`[DEBUG] Elemento do card para ${symbol} criado com sucesso.`);
    return cardElement;
}

function updatePortfolioSummary() {
    const validStocks = state.stocks.filter(stock => stock.data);
    
    DOM.totalAssetsElement.textContent = validStocks.length;
    
    if (validStocks.length === 0) {
        DOM.dailyChangeElement.textContent = '0.00%';
        DOM.dailyChangeElement.className = 'value neutral';
        DOM.totalValueElement.textContent = 'R$ 0,00';
        return;
    }
    
    let totalValue = 0;
    let totalChangePercent = 0;
    
    validStocks.forEach(stock => {
        totalValue += stock.data.price;
        totalChangePercent += parseFloat(stock.data.changePercent);
    });
    
    const avgChangePercent = totalChangePercent / validStocks.length;
    
    DOM.totalValueElement.textContent = formatCurrency(totalValue);
    DOM.dailyChangeElement.textContent = `${avgChangePercent >= 0 ? '+' : ''}${avgChangePercent.toFixed(2)}%`;
    DOM.dailyChangeElement.className = `value ${avgChangePercent >= 0 ? 'positive' : 'negative'}`;
}

function updateUpdateTime() {
    const now = new Date();
    const timeString = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    DOM.updateTimeElement.textContent = timeString;
    state.lastUpdateTime = now;
}

// ==================== FUNÇÕES UTILITÁRIAS ====================

function formatCurrency(value) {
    if (typeof value !== 'number' || isNaN(value)) return 'R$ --,--';
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
    }).format(value);
}

function formatNumber(value) {
    if (typeof value !== 'number' || isNaN(value)) return '--';
    return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
}

function showNotification(message, type = 'info') {
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 24px;
        background: ${type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : type === 'success' ? '#10b981' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, 3000);
}

// ==================== INICIALIZAÇÃO ====================

function setupEventListeners() {
    // Adicionar ação
    DOM.addButton.addEventListener('click', async () => {
        const symbol = DOM.stockInput.value;
        if (addStockToState(symbol)) {
            DOM.stockInput.value = '';
            await updateStockWithChart(symbol);
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
}

function addDynamicStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .stock-card.loading {
            opacity: 0.7;
            position: relative;
            overflow: hidden;
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
        
        .chart-container {
            height: 120px;
            margin: 1rem 0;
            position: relative;
        }
        
        .chart-container canvas {
            width: 100% !important;
            height: 100% !important;
        }
        
        .no-chart-data {
            text-align: center;
            color: var(--text-muted);
            padding: 2rem 0;
            font-size: 0.9rem;
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
        
        .price-indicator {
            width: 48px;
            height: 48px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
            font-weight: bold;
            transition: all 0.3s ease;
        }
    `;
    document.head.appendChild(style);
}

async function initializeApp() {
    console.log('Inicializando FinDash com Chart.js...');
    
    // 1. Adicionar estilos dinâmicos
    addDynamicStyles();
    
    // 2. Carregar estado
    loadStocksFromStorage();
    
    // 3. Configurar eventos
    setupEventListeners();
    
    // 4. Renderizar estado inicial
    updatePortfolioSummary();
    updateUpdateTime();
    
    // 5. Carregar dados iniciais (limitado a 2 para economizar API)
    const initialStocks = state.stocks.slice(0, 2);
    for (const stock of initialStocks) {
        if (stock.symbol) {
            await updateStockWithChart(stock.symbol);
            await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
    
    // 6. Atualizar resumo final
    updatePortfolioSummary();
    
    // 7. Configurar atualização automática (a cada 2 minutos)
    setInterval(() => {
        if (state.stocks.length > 0 && !state.isUpdating) {
            fetchAllStocksData();
        }
    }, 120000);
    
    console.log('FinDash inicializado com sucesso!');
}

// ==================== EXECUÇÃO ====================

// Inicializar quando o DOM estiver carregado
document.addEventListener('DOMContentLoaded', () => {
    initializeApp().catch(error => {
        console.error('Erro na inicialização:', error);
        showNotification('Erro ao inicializar o dashboard', 'error');
    });
});

// Funções para debug no console
window.finDash = {
    state: () => state,
    refresh: () => fetchAllStocksData(),
    addStock: async (symbol) => {
        if (addStockToState(symbol)) {
            await updateStockWithChart(symbol);
            updatePortfolioSummary();
        }
    },
    clearStorage: () => {
        localStorage.removeItem('finDash_stocks');
        location.reload();
    }
};