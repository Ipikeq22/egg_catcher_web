// 遊戲設定
const GAME_CONFIG = {
    eggSpeed: 4,
    bombSpeed: 5,
    spawnRate: 60, // 幀數間隔
    gravity: 0.05,
    basketWidth: 100,
    basketHeight: 40,
    gameDuration: 120, // 2分鐘
    crazyModeTime: 30, // 1分半時進入瘋狂模式
    easyPhase: 20 // 前20秒簡單模式
};

// 狀態變數
let score = 0;
let gameActive = false;
let spawnTimer = 0;
let currentSpawnRate = GAME_CONFIG.spawnRate;
let globalSpeedMultiplier = 1;
let gameTimer = 0;
let isCrazyMode = false;
let crazyModeActivated = false;
let isRegionMode = false; // 地域模式旗標：進入時暫停 BGM

// Pixi 應用程式
const app = new PIXI.Application({
    background: 0x87D68A, // 農場綠色背景
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
});
document.body.appendChild(app.view);

// 容器
const gameScene = new PIXI.Container();
const uiScene = new PIXI.Container();
const gameOverScene = new PIXI.Container();

app.stage.addChild(gameScene);
app.stage.addChild(uiScene);
app.stage.addChild(gameOverScene);

// --- HTML 說明面板控制 ---
const howtoOverlay = document.getElementById('howto-overlay');
const howtoStartBtn = document.getElementById('howto-start-btn');

function showHowtoOverlay() {
    if (howtoOverlay) {
        howtoOverlay.classList.remove('hidden');
        howtoOverlay.setAttribute('aria-hidden', 'false');
    }
}
function hideHowtoOverlay() {
    if (howtoOverlay) {
        howtoOverlay.classList.add('hidden');
        howtoOverlay.setAttribute('aria-hidden', 'true');
    }
}

if (howtoStartBtn) {
    // This event listener is redundant and will be handled by the one in DOMContentLoaded
    /*
    howtoStartBtn.addEventListener('click', () => {
        playSound('btn');
        hideHowtoOverlay();
        startGame();
    });
    */
}

// 紋理緩存 (Textures)
let eggTexture, badEggTexture, bombTexture, goldTexture, basketTexture, logoTexture;

// CDN 圖片 URL
const IMAGE_URLS = {
    egg: 'https://cdn-icons-png.flaticon.com/128/528/528166.png',
    badEgg: 'https://cdn-icons-png.flaticon.com/128/10291/10291934.png',
    bomb: 'https://cdn-icons-png.flaticon.com/128/8517/8517884.png',
    gold: 'https://cdn-icons-png.flaticon.com/128/16575/16575757.png',
    basket: './basket.png',
    logo: './game_logo.png'
};

// 音效 URL
const AUDIO_URLS = {
    bgm: './Chicken Breakdown Hoedown.mp3',
    bombFall: './bomb_fall.mp3',
    bombBlow: './bomb_blow.mp3',
    egg: './egg_sfx.mp3',
    coin: './coin05.mp3',
    btn: './btn_sfx.mp3',
    error: 'https://assets.mixkit.co/active_storage/sfx/2574/2574-preview.mp3', // 壞蛋錯誤音效（示例）
    gameOver: './遊戲結束_音樂.mp3',
    death: './遊戲死亡音樂.mp3'
};

// 音效初始化與播放
let _audioInited = false;
const sounds = {};
let _activeAudio = new Set();
let _masterGain = 1.0;     // 全局增益為避免爆音
const MAX_CONCURRENT = 8;  // 同時播放上限

let lastBombFallTime = 0; // 用於限制炸彈音效頻率
const BOMB_SOUND_COOLDOWN = 100; // 炸彈音效冷卻時間(毫秒)

function initAudio() {
    if (_audioInited) return;
    try {
        sounds.bgm = new Audio(AUDIO_URLS.bgm);
        sounds.bombFall = new Audio(AUDIO_URLS.bombFall);
        sounds.bombBlow = new Audio(AUDIO_URLS.bombBlow);
        sounds.egg = new Audio(AUDIO_URLS.egg);
        sounds.coin = new Audio(AUDIO_URLS.coin);
        sounds.error = new Audio(AUDIO_URLS.error);
        sounds.btn = new Audio(AUDIO_URLS.btn);
        sounds.gameOver = new Audio(AUDIO_URLS.gameOver);
        sounds.death = new Audio(AUDIO_URLS.death);

        Object.values(sounds).forEach(a => {
            a.preload = 'auto';
        });

        // 個別音量基準（之後還會乘以 _masterGain）
        sounds.bgm.loop = true;
        // 預設為不大的音量（使用者需求：撥放音量不要大）
        sounds.bgm.volume = 0.5;
        sounds.bombFall.volume = 0.05;
        sounds.bombBlow.volume = 0.9;
        sounds.egg.volume = 0.6;
        sounds.coin.volume = 0.7;
        sounds.error.volume = 0.8;
        sounds.btn.volume = 0.7;
        sounds.gameOver.volume = 0.8;
        sounds.death.volume = 0.8;
    } catch (e) {
        console.warn('初始化音效失敗', e);
    }
    _audioInited = true;
}

function _applyMasterGain(audio) {
    // 利用 volume 疊乘實現簡易總線增益
    audio.volume = Math.min(1, (audio.volume || 1) * _masterGain);
}

function _trimActivePool() {
    // 限制同時播放聲道數，超出則停止最舊的
    if (_activeAudio.size > MAX_CONCURRENT) {
        const first = _activeAudio.values().next().value;
        try { first.pause(); } catch (e) {}
        _activeAudio.delete(first);
    }
}

function playSound(name) {
    if (!_audioInited) {
        initAudio();
    }
    // 限制炸彈降落音效的播放頻率以避免爆音
    if (name === 'bombFall') {
        const now = performance.now();
        const cooldown = isCrazyMode ? 500 : BOMB_SOUND_COOLDOWN; // 瘋狂模式下冷卻時間更長
        if (now - lastBombFallTime < cooldown) {
            return; // 尚在冷卻時間內，不播放
        }
        lastBombFallTime = now;
    }

    try {
        const base = sounds[name];
        if (!base) return;
        const a = base.cloneNode(true);
        _applyMasterGain(a);
        a.addEventListener('ended', () => _activeAudio.delete(a));
        a.addEventListener('error', () => _activeAudio.delete(a));
        _activeAudio.add(a);
        _trimActivePool();
        a.play().catch(() => { _activeAudio.delete(a); });
    } catch (e) {
        // ignore
    }
}

function setMasterGain(g) {
    // 0.0 ~ 1.0，避免爆音時可調降
    _masterGain = Math.max(0, Math.min(1, g));
}

// --- 地域模式（Region Mode）控制 ---
function enterRegionMode() {
    if (isRegionMode) return;
    isRegionMode = true;
    try {
        if (sounds && sounds.bgm && !sounds.bgm.paused) {
            sounds.bgm.pause();
        }
    } catch (e) {
        console.warn('enterRegionMode error', e);
    }
}

function exitRegionMode() {
    if (!isRegionMode) return;
    isRegionMode = false;
    try {
        if (sounds && sounds.bgm) {
            // 恢復播放（從頭或接續由設計決定，這裡嘗試接續）
            _applyMasterGain(sounds.bgm);
            sounds.bgm.play().catch(() => {});
        }
    } catch (e) {
        console.warn('exitRegionMode error', e);
    }
}

// 提供全域接口與自訂事件，方便其他模組呼叫或以事件方式切換
window.enterRegionMode = enterRegionMode;
window.exitRegionMode = exitRegionMode;
window.setRegionMode = function(on) { if (on) enterRegionMode(); else exitRegionMode(); };
document.addEventListener('enterRegionMode', enterRegionMode);
document.addEventListener('exitRegionMode', exitRegionMode);

// --- 初始化圖形 ---
async function initGraphics() {
    try {
        // 使用 PIXI.Assets 載入圖片
        eggTexture = await PIXI.Assets.load(IMAGE_URLS.egg);
        badEggTexture = await PIXI.Assets.load(IMAGE_URLS.badEgg);
        bombTexture = await PIXI.Assets.load(IMAGE_URLS.bomb);
        goldTexture = await PIXI.Assets.load(IMAGE_URLS.gold);
        basketTexture = await PIXI.Assets.load(IMAGE_URLS.basket);
        logoTexture = await PIXI.Assets.load(IMAGE_URLS.logo);
        
        console.log('所有圖片載入完成');
        return true;
    } catch (error) {
        console.error('圖片載入失敗:', error);
        return false;
    }
}

// --- 遊戲物件 ---
let basket;
let fallingObjects = [];
let scoreText;
let timerText;
let mainMessageText;
let subMessageText;

function setup() {
    // 創建籃子
    basket = new PIXI.Sprite(basketTexture);
    basket.anchor.set(0.5, 0.5);
    basket.scale.set(0.2, 0.2);
    basket.y = app.screen.height - 80;
    basket.x = app.screen.width / 2;
    gameScene.addChild(basket);

    // 創建農場風格UI文字樣式
    const farmStyle = new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 18,
        fill: "#8B4513",
        stroke: '#FFFFFF',
        strokeThickness: 2,
        fontWeight: 'bold'
    });

    // 創建分數面板容器
    const scoreContainer = new PIXI.Container();
    
    // 分數面板外框陰影
    const scoreShadow = new PIXI.Graphics();
    scoreShadow.beginFill(0x000000, 0.4);
    scoreShadow.drawRoundedRect(6, 6, 160, 60, 30);
    scoreShadow.endFill();
    scoreContainer.addChild(scoreShadow);
    
    // 分數面板背景漸層
    const scorePanel = new PIXI.Graphics();
    scorePanel.beginFill(0xFFD700, 1); // 金色背景
    scorePanel.lineStyle(4, 0xFF8C00, 1); // 橙色邊框
    scorePanel.drawRoundedRect(0, 0, 160, 60, 30);
    scorePanel.endFill();
    
    // 內層光澤效果
    scorePanel.beginFill(0xFFFFFF, 0.4);
    scorePanel.drawRoundedRect(4, 4, 152, 25, 25);
    scorePanel.endFill();
    
    // 裝飾性光暈
    scorePanel.beginFill(0xFFE55C, 0.6);
    scorePanel.drawRoundedRect(8, 35, 144, 8, 4);
    scorePanel.endFill();
    
    scoreContainer.addChild(scorePanel);
    
    // 分數文字樣式
    const scoreStyle = new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 26,
        fill: "#FFFFFF",
        stroke: '#000000',
        strokeThickness: 4,
        fontWeight: 'bold',
        dropShadow: true,
        dropShadowColor: '#000000',
        dropShadowBlur: 3,
        dropShadowDistance: 3
    });
    
    scoreText = new PIXI.Text('🥚 0', scoreStyle);
    scoreText.anchor.set(0.5);
    scoreText.x = 80;
    scoreText.y = 30;
    scoreContainer.addChild(scoreText);
    
    scoreContainer.x = 20;
    scoreContainer.y = 20;
    uiScene.addChild(scoreContainer);

    // 創建時間面板容器
    const timerContainer = new PIXI.Container();
    
    // 時間面板外框陰影
    const timerShadow = new PIXI.Graphics();
    timerShadow.beginFill(0x000000, 0.4);
    timerShadow.drawRoundedRect(6, 6, 180, 60, 30);
    timerShadow.endFill();
    timerContainer.addChild(timerShadow);
    
    // 時間面板背景
    const timerPanel = new PIXI.Graphics();
    timerPanel.beginFill(0x32CD32, 1); // 綠色背景
    timerPanel.lineStyle(4, 0x228B22, 1); // 深綠邊框
    timerPanel.drawRoundedRect(0, 0, 180, 60, 30);
    timerPanel.endFill();
    
    // 內層光澤效果
    timerPanel.beginFill(0xFFFFFF, 0.4);
    timerPanel.drawRoundedRect(4, 4, 172, 25, 25);
    timerPanel.endFill();
    
    // 裝飾性光暈
    timerPanel.beginFill(0x90EE90, 0.6);
    timerPanel.drawRoundedRect(8, 35, 164, 8, 4);
    timerPanel.endFill();
    
    timerContainer.addChild(timerPanel);
    
    // 時間文字樣式
    const timerStyle = new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 26,
        fill: "#FFFFFF",
        stroke: '#000000',
        strokeThickness: 4,
        fontWeight: 'bold',
        dropShadow: true,
        dropShadowColor: '#000000',
        dropShadowBlur: 3,
        dropShadowDistance: 3
    });
    
    timerText = new PIXI.Text('⏰ 2:00', timerStyle);
    timerText.anchor.set(0.5);
    timerText.x = 90;
    timerText.y = 30;
    timerContainer.addChild(timerText);
    
    timerContainer.x = app.screen.width - 200;
    timerContainer.y = 20;
    uiScene.addChild(timerContainer);

    // 創建背景裝飾元素
    createBackgroundElements();

    // 使用logo圖片取代文字標題
    gameOverScene.visible = true;
    
    const logoSprite = new PIXI.Sprite(logoTexture);
    logoSprite.anchor.set(0.5);
    logoSprite.x = app.screen.width / 2;
    logoSprite.y = app.screen.height / 2 - 80;
    logoSprite.scale.set(0.5, 0.5);
    gameOverScene.addChild(logoSprite);
    
    mainMessageText = logoSprite;

    // 創建開始按鈕
    createStartButton();
    
    // 鍵盤控制設定
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // 初始隱藏UI和籃子
    uiScene.visible = false;
    basket.visible = false;
}

// 創建農場背景裝飾元素
function createBackgroundElements() {
    // 創建草地底部
    const grass = new PIXI.Graphics();
    grass.beginFill(0x228B22, 0.3);
    grass.drawRect(0, app.screen.height - 100, app.screen.width, 100);
    grass.endFill();
    gameScene.addChildAt(grass, 0);
    
    // 創建可愛的雲朵
    for (let i = 0; i < 4; i++) {
        const cloud = new PIXI.Graphics();
        cloud.beginFill(0xffffff, 0.8);
        cloud.drawCircle(0, 0, 25 + Math.random() * 15);
        cloud.drawCircle(20, 0, 20 + Math.random() * 10);
        cloud.drawCircle(40, 0, 25 + Math.random() * 15);
        cloud.endFill();
        
        cloud.x = Math.random() * app.screen.width;
        cloud.y = Math.random() * app.screen.height * 0.4;
        cloud.speed = 0.1 + Math.random() * 0.2;
        
        gameScene.addChildAt(cloud, 1);
        
        const cloudTicker = () => {
            cloud.x += cloud.speed;
            if (cloud.x > app.screen.width + 80) {
                cloud.x = -80;
            }
        };
        app.ticker.add(cloudTicker);
    }
    
    // 添加農場裝飾元素
    for (let i = 0; i < 3; i++) {
        const flower = new PIXI.Graphics();
        flower.beginFill(0xFF69B4, 0.6);
        flower.drawCircle(0, 0, 8);
        flower.beginFill(0xFFFF00, 0.8);
        flower.drawCircle(0, 0, 3);
        flower.endFill();
        
        flower.x = 50 + Math.random() * (app.screen.width - 100);
        flower.y = app.screen.height - 80 + Math.random() * 30;
        
        gameScene.addChildAt(flower, 1);
    }
}

// 初始化遊戲說明
function initHowToPlay() {
    const howtoOverlay = document.getElementById('howto-overlay');
    const howtoStartBtn = document.getElementById('howto-start-btn');
    
    // 點擊開始按鈕
    /*
    howtoStartBtn.addEventListener('click', () => {
        howtoOverlay.classList.add('hidden');
        howtoOverlay.setAttribute('aria-hidden', 'true');
        startGame();
    });
    */
    
    // 點擊背景關閉
    howtoOverlay.querySelector('.howto-backdrop').addEventListener('click', () => {
        howtoOverlay.classList.add('hidden');
        howtoOverlay.setAttribute('aria-hidden', 'true');
    });
}

// 創建開始按鈕
let startButton, restartButton;

function createStartButton() {
    // 按鈕容器
    startButton = new PIXI.Container();
    
    // 按鈕背景 - 黃底黑字
    const buttonBg = new PIXI.Graphics();
    buttonBg.beginFill(0xFFD700, 0.95);
    buttonBg.lineStyle(4, 0xFFA500);
    buttonBg.drawRoundedRect(0, 0, 200, 60, 30);
    buttonBg.endFill();
    
    // 按鈕陰影
    const buttonShadow = new PIXI.Graphics();
    buttonShadow.beginFill(0xB8860B, 0.3);
    buttonShadow.drawRoundedRect(3, 3, 200, 60, 30);
    buttonShadow.endFill();
    
    startButton.addChild(buttonShadow);
    startButton.addChild(buttonBg);
    
    // 按鈕文字 - 黑色
    const buttonText = new PIXI.Text('開始遊戲', new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 24,
        fill: "#000000",
        fontWeight: 'bold'
    }));
    buttonText.anchor.set(0.5);
    buttonText.x = 100;
    buttonText.y = 30;
    startButton.addChild(buttonText);
    
    startButton.x = app.screen.width / 2 - 100;
    startButton.y = app.screen.height / 2 + 60;
    startButton.eventMode = 'static';
    startButton.cursor = 'pointer';
    
    startButton.on('pointerdown', () => {
        playSound('btn');
        // 顯示遊戲說明面板
        showHowtoOverlay();
        initHowToPlay();
    });
    
    gameOverScene.addChild(startButton);
}

function createRestartButton() {
    // 如果 restartButton 已存在於場景中，先將其移除
    if (restartButton && restartButton.parent) {
        restartButton.parent.removeChild(restartButton);
    }

    restartButton = new PIXI.Container();
    
    const buttonBg = new PIXI.Graphics();
    buttonBg.beginFill(0xFF6347, 0.9);
    buttonBg.lineStyle(4, 0xDC143C);
    buttonBg.drawRoundedRect(0, 0, 200, 60, 30);
    buttonBg.endFill();
    
    const buttonShadow = new PIXI.Graphics();
    buttonShadow.beginFill(0x8B0000, 0.3);
    buttonShadow.drawRoundedRect(3, 3, 200, 60, 30);
    buttonShadow.endFill();
    
    restartButton.addChild(buttonShadow);
    restartButton.addChild(buttonBg);
    
    const buttonText = new PIXI.Text('🔄 重新開始 🔄', new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 24,
        fill: "#FFFFFF",
        fontWeight: 'bold'
    }));
    buttonText.anchor.set(0.5);
    buttonText.x = 100;
    buttonText.y = 30;
    restartButton.addChild(buttonText);
    
    restartButton.x = app.screen.width / 2 - 100;
    restartButton.y = app.screen.height / 2 + 80;
    restartButton.eventMode = 'static';
    restartButton.cursor = 'pointer';
    
    // 使用 .once() 來確保監聽器只被觸發一次，避免記憶體洩漏
    restartButton.once('pointerdown', () => {
        playSound('btn');
        // 直接呼叫 startGame，它會負責重置所有狀態
        startGame();
    });
    
    gameOverScene.addChild(restartButton);
}

// 鍵盤控制
const keys = { a: false, d: false };
const BASKET_SPEED = 8; // 籃子移動速度

function onKeyDown(e) {
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') keys.a = true;
    else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') keys.d = true;
}

function onKeyUp(e) {
    if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') keys.a = false;
    else if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') keys.d = false;
}

function startGame() {
    gameActive = true;
    score = 0;
    gameTimer = 0;
    isCrazyMode = false;
    crazyModeActivated = false;
    globalSpeedMultiplier = 1;
    currentSpawnRate = GAME_CONFIG.spawnRate;

    initAudio();
    // 播放背景音樂
    try {
        if (!isRegionMode && sounds && sounds.bgm) {
            sounds.bgm.currentTime = 0; // 從頭播放
            _applyMasterGain(sounds.bgm);
            sounds.bgm.play().catch(() => {});
        }
    } catch (e) {
        console.warn('播放 BGM 失敗', e);
    }
    
    // 清除場上物件
    fallingObjects.forEach(obj => gameScene.removeChild(obj));
    fallingObjects = [];


    // 隐藏分享容器
    const shareContainer = document.getElementById('share-container');
    if (shareContainer) {
        shareContainer.classList.add('hidden');
    }

    // 隐藏開始按鈕 (如果存在)
    if (startButton && startButton.parent) {
        startButton.parent.removeChild(startButton);
    }

    // 顯示籃子
    basket.visible = true;

    // 恢復場景狀態
    gameScene.alpha = 1;
    uiScene.alpha = 1;
    gameScene.filters = [];
    uiScene.filters = [];

    updateUI();
    gameOverScene.visible = false;
    uiScene.visible = true;
    app.renderer.background.color = 0x87D68A;
}

function gameOver(reason = 'time') {
    gameActive = false;
    isCrazyMode = false;
    const finalScore = score; // 保存最終分數

    // 停止背景音樂並播放結束音效
    if (sounds && sounds.bgm) {
        sounds.bgm.pause();
    }
    if (reason === 'death') {
        setTimeout(() => playSound('death'), 1000);
    } else {
        playSound('gameOver');
    }

    // 清空 gameOverScene 以便顯示新內容
    gameOverScene.removeChildren();
    gameOverScene.visible = true;

    // --- 1. 視覺效果 ---
    // 半透明黑色遮罩
    const overlay = new PIXI.Graphics();
    overlay.beginFill(0x000000, 0.7);
    overlay.drawRect(0, 0, app.screen.width, app.screen.height);
    overlay.endFill();
    overlay.alpha = 0; // 初始透明
    gameOverScene.addChild(overlay);

    // 將遊戲背景模糊化
    const blurFilter = new PIXI.BlurFilter();
    blurFilter.blur = 0; // 初始無模糊
    gameScene.filters = [blurFilter];
    uiScene.filters = [blurFilter];
    
    // --- 2. 結束畫面容器 ---
    const panel = new PIXI.Container();
    gameOverScene.addChild(panel);

    // 面板背景
    const panelBg = new PIXI.Graphics();
    panelBg.lineStyle(10, reason === 'death' ? 0x8B0000 : 0xCD853F, 1);
    panelBg.beginFill(0x000000, 0.5);
    panelBg.drawRoundedRect(-180, -150, 360, 300, 20);
    panelBg.endFill();
    panel.addChild(panelBg);
    panel.x = app.screen.width / 2;
    panel.y = app.screen.height / 2;
    panel.alpha = 0;

    // --- 3. 文字內容 ---
    const titleStyle = new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 60,
        fill: reason === 'death' ? "#FF4A4A" : "#FFD700",
        fontWeight: 'bold',
        stroke: '#000000',
        strokeThickness: 8,
        dropShadow: true, dropShadowColor: '#000000', dropShadowBlur: 10, dropShadowDistance: 5
    });

    const titleText = new PIXI.Text(reason === 'death' ? '你死了！' : '時間到！', titleStyle);
    titleText.anchor.set(0.5);
    titleText.y = -80;
    titleText.scale.set(0); // 初始縮小
    panel.addChild(titleText);

    const scoreStyle = new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 36,
        fill: "#FFFFFF",
        fontWeight: 'bold',
        stroke: '#000000',
        strokeThickness: 4
    });
    
    const finalScoreLabel = new PIXI.Text('最終分數', { ...scoreStyle, fontSize: 24, fill: '#CCCCCC' });
    finalScoreLabel.anchor.set(0.5, 1);
    finalScoreLabel.y = -5;
    panel.addChild(finalScoreLabel);

    const finalScoreText = new PIXI.Text('0', scoreStyle);
    finalScoreText.anchor.set(0.5, 0);
    finalScoreText.y = 5;
    panel.addChild(finalScoreText);

    // --- 4. 重新開始按鈕 (先創建但設為不可見) ---
    createRestartButton(); // 創建按鈕
    restartButton.alpha = 0;
    restartButton.y = app.screen.height / 2 + 100;
    
    // --- 5. 動畫 ---
    let elapsed = 0;
    const DURATION = 60; // 1秒動畫
    let scoreCounted = false;

    const animationTicker = (delta) => {
        elapsed += delta;
        const progress = Math.min(1, elapsed / DURATION);

        // 遮罩與模糊
        overlay.alpha = progress * 0.7;
        blurFilter.blur = progress * 8;
        panel.alpha = progress;

        // 標題彈跳動畫
        if (progress < 0.8) {
            titleText.scale.set(progress / 0.8);
        } else {
            const bounce = 1 + (1 - progress) / 0.2 * 0.1; // 1 -> 1.1 -> 1
            titleText.scale.set(bounce);
        }

        // 分數計數動畫
        if (progress > 0.5 && !scoreCounted) {
             let currentScore = 0;
             const targetScore = finalScore;
             const scoreTicker = (d) => {
                const increment = Math.ceil((targetScore - currentScore) * 0.1) || (targetScore > currentScore ? 1 : -1);
                 currentScore += increment;
                 if ((increment > 0 && currentScore >= targetScore) || (increment < 0 && currentScore <= targetScore)) {
                     currentScore = targetScore;
                     finalScoreText.text = `${currentScore}`;
                     app.ticker.remove(scoreTicker);
                     // 分數計數完成後，顯示按鈕和分享工具
                     restartButton.alpha = 1;
                     setupShareButtons(finalScore);
                 }
                 finalScoreText.text = `${currentScore}`;
             };
             app.ticker.add(scoreTicker);
             scoreCounted = true;
        }

        if (progress >= 1) {
            app.ticker.remove(animationTicker);
        }
    };
    app.ticker.add(animationTicker);

    // 隱藏遊戲中的 UI 和籃子
    uiScene.visible = false;
    basket.visible = false;
    app.stage.position.set(0,0);
}

function enterCrazyMode() {
    if (crazyModeActivated) return;
    crazyModeActivated = true;
    isCrazyMode = true;
    globalSpeedMultiplier = 2;
    currentSpawnRate = Math.max(15, GAME_CONFIG.spawnRate / 2);
    
    // 改變背景顏色為警告紅
    app.renderer.background.color = 0xFF8C69;
    
    // 地獄模式：物件亂飄 + 輕微畫面震動
    app.stage.position.x = 0;
    app.stage.position.y = 0;

    // 加入輕微的全局震動（幅度小，僅做氛圍）
    const amplitude = 3;
    const crazyShake = () => {
        if (isCrazyMode && gameActive) {
            app.stage.position.x = (Math.random() - 0.5) * amplitude;
            app.stage.position.y = (Math.random() - 0.5) * amplitude;
        } else {
            app.stage.position.x = 0;
            app.stage.position.y = 0;
            app.ticker.remove(crazyShake);
        }
    };
    app.ticker.add(crazyShake);
}

function updateUI() {
    // 更新分數顯示 - 統一使用白色
    scoreText.style.fill = "#FFFFFF";
    scoreText.text = `🥚 ${score}`;
    
    // 更新計時器 - 統一使用白色
    const remainingTime = Math.max(0, GAME_CONFIG.gameDuration - gameTimer);
    const minutes = Math.floor(remainingTime / 60);
    const seconds = Math.floor(remainingTime % 60);
    
    timerText.style.fill = "#FFFFFF";
    timerText.text = `⏰ ${minutes}:${seconds.toString().padStart(2, '0')}`;
}

// 難度與速度隨時間調整：
// - 前 easyPhase 秒為簡單模式（速度降低、生成較慢）
// - 之後逐步提升速度與生成頻率
function updateDifficulty() {
    const t = gameTimer;
    const easy = GAME_CONFIG.easyPhase || 20;
    if (t < easy) {
        // 簡單期
        globalSpeedMultiplier = 0.85; // 稍慢
        currentSpawnRate = GAME_CONFIG.spawnRate * 1.2; // 生成更慢
    } else {
        // 緩慢加速期
        const totalRamp = Math.max(1, GAME_CONFIG.gameDuration - easy);
        const k = Math.min(1, (t - easy) / totalRamp); // 0~1
        // 速度從 0.85 緩升至 3.0
        globalSpeedMultiplier = 0.85 + k * (3.0 - 0.85);
        // 生成率從原始值降低到 40%（代表更頻繁產生）
        const minRate = Math.max(10, GAME_CONFIG.spawnRate * 0.4);
        currentSpawnRate = GAME_CONFIG.spawnRate - (GAME_CONFIG.spawnRate - minRate) * k;
    }
}

function spawnObject() {
    let rand = Math.random();
    let sprite;
    let type;
    
    // 根據瘋狂模式調整掉落物比例
    if (isCrazyMode) {
        // 瘋狂模式：炸彈 30%、壞雞蛋 30%、好雞蛋 30%、金塊 10%
        if (rand < 0.3) {
            type = 'bomb';
        } else if (rand < 0.6) {
            type = 'badEgg';
        } else if (rand < 0.9) {
            type = 'egg';
        } else {
            type = 'gold';
        }
    } else {
        // 正常模式：炸彈 15%、壞雞蛋 15%、好雞蛋 60%、金塊 10%
        if (rand < 0.15) {
            type = 'bomb';
        } else if (rand < 0.3) {
            type = 'badEgg';
        } else if (rand < 0.9) {
            type = 'egg';
        } else {
            type = 'gold';
        }
    }
    
    if (type === 'bomb') {
        sprite = new PIXI.Sprite(bombTexture);
        sprite.type = 'bomb';
        sprite.vy = GAME_CONFIG.bombSpeed;
        sprite.scale.set(0.6, 0.6);
        // 播放炸彈降落音效
        playSound('bombFall');
    } else if (type === 'badEgg') {
        sprite = new PIXI.Sprite(badEggTexture);
        sprite.type = 'badEgg';
        sprite.vy = GAME_CONFIG.eggSpeed + Math.random() * 2;
        sprite.scale.set(0.6, 0.6);
    } else if (type === 'gold') {
        sprite = new PIXI.Sprite(goldTexture);
        sprite.type = 'gold';
        sprite.vy = GAME_CONFIG.eggSpeed + Math.random() * 1.5;
        sprite.scale.set(0.6, 0.6);
    } else {
        sprite = new PIXI.Sprite(eggTexture);
        sprite.type = 'egg';
        sprite.vy = GAME_CONFIG.eggSpeed + Math.random() * 2;
        sprite.scale.set(0.6, 0.6);
    }

    sprite.anchor.set(0.5);
    // 隨機 X 位置，但在邊界內
    const margin = 30;
    sprite.x = margin + Math.random() * (app.screen.width - margin * 2);
    sprite.y = -50; // 從螢幕上方外面開始
    
    // 加入些微旋轉效果
    sprite.rotationSpeed = (Math.random() - 0.5) * 0.1;

    gameScene.addChild(sprite);
    fallingObjects.push(sprite);
}

// 碰撞檢測 (AABB 簡單版)
function checkCollision(a, b) {
    const aBox = a.getBounds();
    const bBox = b.getBounds();

    return aBox.x + aBox.width > bBox.x &&
           aBox.x < bBox.x + bBox.width &&
           aBox.y + aBox.height > bBox.y &&
           aBox.y < bBox.y + bBox.height;
}

// 主遊戲循環
app.ticker.add((delta) => {
    if (!gameActive) return;

    // 更新籃子位置和旋轉
    if (basket) {
        let targetRotation = 0;
        if (keys.a && !keys.d) {
            basket.x -= BASKET_SPEED * delta;
            targetRotation = -0.2;
        } else if (keys.d && !keys.a) {
            basket.x += BASKET_SPEED * delta;
            targetRotation = 0.2;
        }

        // 平滑旋轉
        basket.rotation += (targetRotation - basket.rotation) * 0.1;

        // 限制籃子在螢幕內
        const halfWidth = basket.width / 2;
        if (basket.x < halfWidth) {
            basket.x = halfWidth;
        }
        if (basket.x > app.screen.width - halfWidth) {
            basket.x = app.screen.width - halfWidth;
        }
    }

    // 更新計時器 (delta 是幀數，需要轉換為秒)
    gameTimer += delta / 60;
    
    // 檢查是否進入瘋狂模式 (1分半 = 90秒)
    if (gameTimer >= GAME_CONFIG.gameDuration - GAME_CONFIG.crazyModeTime && !crazyModeActivated) {
        enterCrazyMode();
    }
    
    // 檢查遊戲時間是否結束
    if (gameTimer >= GAME_CONFIG.gameDuration) {
        gameOver('time');
        return;
    }

    // 更新難度（速度與生成頻率隨時間變化）
    updateDifficulty();

    // 生成邏輯
    spawnTimer += delta;
    if (spawnTimer >= currentSpawnRate) {
        let count = 2;                        // 0~20 秒：每次 2 個
        const easy = GAME_CONFIG.easyPhase || 20;
        if (gameTimer >= easy) count = 4;     // 20 秒後：每次 4 個
        if (isCrazyMode) count = 6;           // 地獄模式：每次 6 個
        for (let k = 0; k < count; k++) {
            spawnObject();
        }
        spawnTimer = 0;
    }

    // 更新掉落物
    for (let i = fallingObjects.length - 1; i >= 0; i--) {
        const obj = fallingObjects[i];
        
        // 移動
        obj.y += obj.vy * delta * globalSpeedMultiplier;
        obj.rotation += obj.rotationSpeed * delta;



        // 地獄模式：物件亂飄（大幅度）
        if (isCrazyMode) {
            const jitterX = 28;  // 顯著的水平抖動
            const jitterY = 10;  // 顯著的垂直抖動
            const jitterR = 0.6; // 顯著的旋轉抖動
            obj.x += (Math.random() - 0.5) * jitterX * delta;
            obj.y += (Math.random() - 0.5) * jitterY * delta;
            obj.rotation += (Math.random() - 0.5) * jitterR * delta;
            // 基本邊界限制，避免飄出畫面過多
            if (obj.x < 20) obj.x = 20;
            if (obj.x > app.screen.width - 20) obj.x = app.screen.width - 20;
        }

        let remove = false;

        // 1. 檢查是否接到 (只檢測籃子最上方)
        if (obj.y >= basket.y - 60 && obj.y <= basket.y + 5) {
            // 簡的 X 軸距離判斷
            if (Math.abs(obj.x - basket.x) < GAME_CONFIG.basketWidth / 2 + 10) {
                // 接到了！
                if (obj.type === 'egg') {
                    score += 10;
                    createCatchEffect(obj.x, obj.y, "+10 🥚", 0x32CD32);
                    playSound('egg');
                } else if (obj.type === 'badEgg') {
                    score -= 10;
                    createCatchEffect(obj.x, obj.y, "-10 💩", 0xFF6B6B);
                    playSound('error');
                } else if (obj.type === 'bomb') {
                    score -= 50;
                    createCatchEffect(obj.x, obj.y, "-50 💥", 0xFF0000);
                    // 播放炸彈爆炸音效
                    playSound('bombBlow');
                    // 強震 + 短暫黑屏
                    shakeScreen(24, 24);
                    flashBlackout();
                } else if (obj.type === 'gold') {
                    score += 100;
                    createCatchEffect(obj.x, obj.y, "+100 🤘", 0xFFD700);
                    playSound('coin');
                }
                
                // 檢查是否低於 -100 分遊戲結束
                if (score <= -100) {
                    gameOver('death');
                    return;
                }
                
                updateUI();
                remove = true;
            }
        }

        // 2. 檢查是否落地
        if (!remove && obj.y > app.screen.height + 20) {
            remove = true;
        }

        if (remove) {
            gameScene.removeChild(obj);
            fallingObjects.splice(i, 1);
        }
    }
    
    updateUI();
});

// 文字特效
function createCatchEffect(x, y, text, color) {
    // 只在遊戲進行中顯示特效
    if (!gameActive) return;
    
    const style = new PIXI.TextStyle({
        fontFamily: "Microsoft JhengHei",
        fontSize: 20,
        fill: color,
        fontWeight: 'bold',
        stroke: '#000000',
        strokeThickness: 3
    });
    const floatText = new PIXI.Text(text, style);
    floatText.anchor.set(0.5);
    floatText.x = x;
    floatText.y = y;
    gameScene.addChild(floatText);

    let time = 0;
    const effectTicker = (delta) => {
        if (!gameActive) {
            gameScene.removeChild(floatText);
            app.ticker.remove(effectTicker);
            return;
        }
        
        time += delta;
        floatText.y -= 2 * delta;
        floatText.alpha -= 0.02 * delta;
        if (floatText.alpha <= 0) {
            gameScene.removeChild(floatText);
            app.ticker.remove(effectTicker);
        }
    };
    app.ticker.add(effectTicker);
}

// 畫面震動效果
function shakeScreen(intensity = 20, durationFrames = 20) {
    // 更強的畫面震動，帶阻尼衰減
    let elapsed = 0;
    const originalX = app.stage.position.x;
    const originalY = app.stage.position.y;

    const shakeTicker = (delta) => {
        elapsed += delta;
        const progress = Math.min(1, elapsed / durationFrames);
        const damping = 1 - progress; // 逐漸衰減
        const amp = intensity * damping;
        app.stage.position.x = (Math.random() - 0.5) * 2 * amp;
        app.stage.position.y = (Math.random() - 0.5) * 2 * amp;
        if (progress >= 1) {
            app.stage.position.x = 0;
            app.stage.position.y = 0;
            app.ticker.remove(shakeTicker);
        }
    };
    app.ticker.add(shakeTicker);
}

function flashBlackout() {
    // 短暫黑屏：淡入 -> 停留 -> 淡出
    const overlay = new PIXI.Graphics();
    overlay.beginFill(0x000000, 1);
    overlay.drawRect(0, 0, app.screen.width, app.screen.height);
    overlay.endFill();
    overlay.alpha = 0;

    // 置於最上層
    app.stage.addChild(overlay);

    let t = 0;
    const inFrames = 6;   // 淡入幀數
    const holdFrames = 6; // 停留幀數
    const outFrames = 12; // 淡出幀數
    const total = inFrames + holdFrames + outFrames;

    const ticker = (delta) => {
        t += delta;
        if (t < inFrames) {
            overlay.alpha = t / inFrames;
        } else if (t < inFrames + holdFrames) {
            overlay.alpha = 1;
        } else if (t < total) {
            const k = (t - inFrames - holdFrames) / outFrames;
            overlay.alpha = 1 - k;
        } else {
            app.stage.removeChild(overlay);
            overlay.destroy(true);
            app.ticker.remove(ticker);
        }
    };
    app.ticker.add(ticker);
}

// 視窗調整
window.addEventListener('resize', () => {
    // 更新 UI 位置
    if (timerText) timerText.x = app.screen.width - 20;
    if (mainMessageText) {
        mainMessageText.x = app.screen.width / 2;
        mainMessageText.y = app.screen.height / 2 - 50;
    }
    if (subMessageText) {
        subMessageText.x = app.screen.width / 2;
        subMessageText.y = app.screen.height / 2 + 50;
    }
    if (basket) {
        basket.y = app.screen.height - 80;
        // 確保籃子不會跑出新視窗
        if (basket.x > app.screen.width) basket.x = app.screen.width - 50;
    }
});

// 遊戲說明控制
function showHowtoOverlay() {
    const howtoOverlay = document.getElementById('howto-overlay');
    if (howtoOverlay) {
        howtoOverlay.classList.remove('hidden');
        howtoOverlay.setAttribute('aria-hidden', 'false');
    }
}

function hideHowtoOverlay() {
    const howtoOverlay = document.getElementById('howto-overlay');
    if (howtoOverlay) {
        howtoOverlay.classList.add('hidden');
        howtoOverlay.setAttribute('aria-hidden', 'true');
    }
}

// 初始化遊戲說明事件
document.addEventListener('DOMContentLoaded', () => {
    const howtoStartBtn = document.getElementById('howto-start-btn');
    const howtoBackdrop = document.querySelector('.howto-backdrop');
    
    if (howtoStartBtn) {
        howtoStartBtn.addEventListener('click', () => {
            playSound('btn');
            hideHowtoOverlay();

            const loadingOverlay = document.getElementById('loading-overlay');
            if(loadingOverlay) {
                loadingOverlay.classList.remove('hidden');
            }

            setTimeout(() => {
                if(loadingOverlay) {
                    loadingOverlay.classList.add('hidden');
                }
                startGame();
            }, 2000);
        });
    }
    
    if (howtoBackdrop) {
        howtoBackdrop.addEventListener('click', () => {
            playSound('btn');
            hideHowtoOverlay();
        });
    }
});

// 初始化圖片並開始遊戲
initGraphics().then((success) => {
    if (success) {
        setup();
    } else {
        console.error('圖片載入失敗，請檢查 CDN URL');
    }
});

// --- Pause Menu Logic ---
const pauseMenu = document.getElementById('pause-menu');
const resumeButton = document.getElementById('resume-button');
const rateButton = document.getElementById('rate-button');

let isPaused = false;

function pauseGame() {
    if (!gameActive) return; // Don't pause if the game is not active
    isPaused = true;
    app.ticker.stop();
    if (sounds.bgm && !sounds.bgm.paused) {
        sounds.bgm.pause();
    }
    pauseMenu.classList.remove('hidden');
}

function resumeGame() {
    if (!gameActive) return;
    isPaused = false;
    app.ticker.start();
    if (sounds.bgm && sounds.bgm.paused && !isRegionMode) {
        sounds.bgm.play().catch(() => {});
    }
    pauseMenu.classList.add('hidden');
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (isPaused) {
            resumeGame();
        } else {
            pauseGame();
        }
    }
});

resumeButton.addEventListener('click', () => {
    playSound('btn');
    resumeGame();
});

function setupShareButtons(score) {
    const shareContainer = document.getElementById('share-container');
    const shareTwitterBtn = document.getElementById('share-twitter');
    const shareFacebookBtn = document.getElementById('share-facebook');
    const copyLinkBtn = document.getElementById('copy-link');
    const copyFeedback = document.getElementById('copy-feedback');

    if (!shareContainer) return;

    // IMPORTANT: Replace with the actual game URL when deployed
    const gameUrl = 'https://example.com/egg-catcher-game'; // << 請在部署後替換成您的遊戲網址
    const isPlaceholderUrl = gameUrl.includes('example.com');

    const shareText = `我剛剛在「接雞蛋大挑戰」中獲得了 ${score} 分！你敢來挑戰嗎？ #接雞蛋大挑戰`;
    const encodedText = encodeURIComponent(shareText);
    
    if (isPlaceholderUrl) {
        // 如果是預設 URL，分享時不帶上 URL，避免分享無效連結
        shareTwitterBtn.href = `https://twitter.com/intent/tweet?text=${encodedText}`;
        shareFacebookBtn.href = `https://www.facebook.com/sharer/sharer.php?quote=${encodedText}`;
        copyLinkBtn.querySelector('span').textContent = '複製戰績';
    } else {
        const encodedUrl = encodeURIComponent(gameUrl);
        shareTwitterBtn.href = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`;
        shareFacebookBtn.href = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`;
        copyLinkBtn.querySelector('span').textContent = '複製連結';
    }


    copyLinkBtn.onclick = (e) => {
        e.preventDefault();
        playSound('btn');
        const textToCopy = isPlaceholderUrl ? shareText : `${shareText} ${gameUrl}`;
        navigator.clipboard.writeText(textToCopy).then(() => {
            copyFeedback.textContent = '已複製！';
            copyFeedback.classList.remove('hidden');
            setTimeout(() => {
                copyFeedback.classList.add('hidden');
            }, 2000);
        }).catch(err => {
            console.error('無法複製連結: ', err);
            copyFeedback.textContent = '複製失敗';
            copyFeedback.classList.remove('hidden');
             setTimeout(() => {
                copyFeedback.classList.add('hidden');
            }, 2000);
        });
    };

    shareContainer.classList.remove('hidden');
}

