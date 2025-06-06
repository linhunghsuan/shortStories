// =================================================================================
// Script.js - 故事卡競拍遊戲記錄
// =================================================================================

const consoleHistory = []; // 用於儲存所有被捕獲的 console 訊息

// 覆寫 console 的主要方法以捕獲日誌
['log', 'info', 'warn', 'error', 'debug'].forEach(method => { // 添加了 debug
    const originalConsoleMethod = console[method];
    console[method] = function (...args) {
        // 將日誌條目存入歷史記錄
        consoleHistory.push({
            method: method, // log, info, warn, error, debug
            args: args.map(arg => { // 處理各種參數類型
                if (typeof arg === 'object' && arg !== null) {
                    try {
                        return JSON.stringify(arg, null, 2); // 格式化物件為JSON字串
                    } catch (e) {
                        return '[Unserializable Object]'; // 處理無法序列化的物件
                    }
                }
                return String(arg); // 其他類型轉為字串
            }),
            timestamp: new Date().toISOString() // 記錄時間戳
        });
        // 保持原始的 console 功能，訊息仍會顯示在開發者工具中
        originalConsoleMethod.apply(console, args);
    };
});
// ========= 全域遊戲狀態變數 =========
let gameStateBeforeNextRound = null; // 用於競標取消時回溯
let currentBidding = { // 當前競標狀態
    cardId: null,
    bidders: [],
    bids: [],
    step: 0,
    resolvePromise: null,
    // 以下兩個欄位由 resolveBidding 填充，並由 nextRound 檢查
    needsConsolationDraw: false,     // 標記競標結果是否需要抽牌
    tiedPlayersForConsolation: []  // 參與抽牌的玩家
};
let players = []; // 當前參與遊戲的玩家ID列表 (['A'], ['A', 'B'], or ['A', 'B', 'C'])
const PLAYER_ID_MAP = ['A', 'B', 'C']; // 玩家ID映射
let playerTimes = {};       // { playerId: time, ... }
let playerActions = {};     // { playerId: actionChoice (cardId, '休息', or [cardId1, cardId2]), ... }
let playerCharacterSelections = {}; // { playerId: characterKeyFromSettings, ... } (角色key, e.g., "1", "2")
let playerCharacterSkills = {}; // { playerId: { type: 'SKILL_TYPE', value: ..., description: "..." }, ... }
let playerTurnChoices = {};   // { playerId: { count: 0, actions: [], firstChoiceWasCard: false }, ... } (主要用於技能6)

let marketCards = [];       // 本回合市場上最終確認的卡片ID列表 (由 confirmMarket 設定)
let selectedMarket = [];    // 玩家在市場選擇階段點選的卡片ID列表
let timeline = {};          // { playerId: [eventObjects], ... }

let round = 1;              // 當前回合數
let selectedPlayerCount = 0;  // 設定階段選擇的玩家人數

// ========= 常數與資料設定 =========
let cardData = null;        // 從 cards.json 載入
let characterSettings = null; // 從 characters.json 載入
let characterNames = [];    // 可選的角色名稱(key)列表 (e.g., ["1", "2", ...])

const MAX_TIME = 12;                // 玩家最大時間上限
const BASE_REST_RECOVERY_AMOUNT = 6; // 基礎休息恢復量 (未使用技能時)

// 時間軸視覺化相關常數
const TIME_UNIT_WIDTH = 40; // 時間軸上每個時間單位代表的寬度 (px)
const MIN_EVENT_SEGMENT_WIDTH = TIME_UNIT_WIDTH; // 事件在時間軸上的最小寬度 (px)
const EVENT_SEGMENT_HEIGHT = '25px'; // 事件在時間軸上的高度

let availableCards = [];    // 遊戲中所有可用的卡片ID列表 (會隨遊戲進程減少)

// ========= 應用程式初始化 =========
async function initializeAppData() {
    try {
        const [cardsResponse, charactersResponse] = await Promise.all([
            fetch('./data/cards.json'),
            fetch('./data/characters.json')
        ]);

        if (!cardsResponse.ok) throw new Error(`無法載入卡片資料: ${cardsResponse.statusText} (路徑: ${cardsResponse.url})`);
        if (!charactersResponse.ok) throw new Error(`無法載入角色資料: ${charactersResponse.statusText} (路徑: ${charactersResponse.url})`);

        cardData = await cardsResponse.json();
        characterSettings = await charactersResponse.json();

        if (!cardData || Object.keys(cardData).length === 0) throw new Error("卡片資料為空或格式不正確。");
        if (!characterSettings || Object.keys(characterSettings).length === 0) throw new Error("角色資料為空或格式不正確。");

        characterNames = Object.keys(characterSettings);
        availableCards = Object.keys(cardData).map(id => parseInt(id));

        console.log(`回合準備: ${Object.keys(cardData).length}張卡片，${characterNames.length}種角色`);

        document.getElementById('player1').disabled = false;
        document.getElementById('player2').disabled = false;
        document.getElementById('player3').disabled = false;
        document.getElementById('startButton').disabled = true;

    } catch (error) {
        console.error("初始化錯誤: ", error);
        alert(`初始錯誤: 無法載入遊戲設定檔(${error.message})\n請檢查 console 的詳細錯誤訊息，並確認 JSON 檔案路徑及內容`);
    }
}
document.addEventListener('DOMContentLoaded', initializeAppData);

// ========= 輔助函式 =========
function determineMaxMarketSelectionCount() {
    let marketSize = selectedPlayerCount + 1;
    let skill8Active = players.some(p_id =>
        playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "EXTRA_MARKET_CARD"
    );
    if (skill8Active) marketSize++;
    return Math.min(marketSize, availableCards.length);
}

// purchaseContext: 'direct_buy', 'bid_win', 'consolation_draw'
function getAdjustedCardCost(playerId, basePrice, purchaseContext) {
    let finalPrice = basePrice;
    const skillInfo = playerCharacterSkills[playerId];

    if (skillInfo) {
        // 技能1: 嘗試新奇事物的人 (通用減費)
        if (skillInfo.type === "REDUCE_COST_GENERAL") {
            finalPrice -= skillInfo.value;
        }
        // 技能5: 堅定志向的人 (僅抽牌購買時減費)
        else if (skillInfo.type === "REDUCE_COST_CONSOLATION_DRAW" && purchaseContext === 'consolation_draw') {
            finalPrice -= skillInfo.value;
        }
    }
    return Math.max(0, finalPrice); // 確保價格不為負
}

// ========= 設定階段函式 =========
function selectPlayerCountUI(count) {
    if (!characterSettings || characterNames.length === 0) {
        alert("初始錯誤: 角色資料仍在載入中或載入失敗，請稍候");
        return;
    }
    const playerOptionsButtons = document.querySelectorAll('.player-options button');
    const clickedButton = document.getElementById(`player${count}`);
    const errorMsgElement = document.getElementById('characterSelectionError');
    errorMsgElement.textContent = ''; // 清除先前錯誤

    if (selectedPlayerCount === count) { // 取消選擇人數
        selectedPlayerCount = 0;
        playerCharacterSelections = {};
        displayCharacterSelection(0); // 隱藏角色選擇UI
        playerOptionsButtons.forEach(btn => {
            btn.classList.remove('selected');
            btn.disabled = false; // 全部啟用
        });
        document.getElementById('confirmCharactersButton').disabled = true;
        document.getElementById('startButton').disabled = true;
    } else { // 選擇新的人數
        selectedPlayerCount = count;
        playerCharacterSelections = {}; // 重置角色選擇
        playerOptionsButtons.forEach(btn => {
            btn.classList.remove('selected');
            btn.disabled = (btn !== clickedButton); // 只禁用未選中的人數按鈕
        });
        clickedButton.classList.add('selected');
        displayCharacterSelection(count); // 顯示對應人數的角色選擇器
        document.getElementById('confirmCharactersButton').disabled = false;
        document.getElementById('confirmCharactersButton').classList.remove('selected');
        document.getElementById('startButton').disabled = true;
    }
}

function displayCharacterSelection(playerCount) {
    const container = document.getElementById('characterSelectorsContainer');
    container.innerHTML = ''; // 清空舊的選擇器
    const uiWrapper = document.getElementById('characterSelectionUI');
    const errorMsgElement = document.getElementById('characterSelectionError');
    errorMsgElement.textContent = ''; // 清除先前錯誤

    if (playerCount > 0 && characterNames.length > 0) {
        for (let i = 0; i < playerCount; i++) {
            const playerID = PLAYER_ID_MAP[i];
            const div = document.createElement('div');
            div.className = 'character-selector-wrapper';

            const label = document.createElement('label');
            label.htmlFor = `characterSelect${playerID}`;
            label.textContent = `玩家 ${playerID} 選擇角色: `;

            const select = document.createElement('select');
            select.id = `characterSelect${playerID}`;
            select.innerHTML = '<option value="">--請選擇角色--</option>'; // 預設空選項

            characterNames.forEach(charKey => { // charKey is "1", "2", etc.
                const character = characterSettings[charKey];
                const option = document.createElement('option');
                option.value = charKey; // 儲存key
                let skillDesc = character.skill && character.skill.description ? ` (${character.skill.description})` : ' (無特殊技能)';
                option.textContent = `${character.name} (起始時間: ${character.startTime})${skillDesc}`;
                select.appendChild(option);
            });
            div.appendChild(label);
            div.appendChild(select);
            container.appendChild(div);
        }
        uiWrapper.style.display = 'block';
    } else {
        uiWrapper.style.display = 'none';
    }
}

function confirmCharacterSelections() {
    playerCharacterSelections = {}; // 重置
    let allPlayersHaveChosen = true;
    const chosenCharacterKeys = new Set(); // 用來檢查重複選擇 (存key)
    const errorMsgElement = document.getElementById('characterSelectionError');
    errorMsgElement.textContent = ''; // 清除舊訊息

    for (let i = 0; i < selectedPlayerCount; i++) {
        const playerID = PLAYER_ID_MAP[i];
        const selectElement = document.getElementById(`characterSelect${playerID}`);
        const selectedCharKey = selectElement.value;

        if (!selectedCharKey) {
            allPlayersHaveChosen = false;
            errorMsgElement.textContent = `錯誤提示: 玩家 ${playerID} 尚未選擇角色`;
            break;
        }
        if (chosenCharacterKeys.has(selectedCharKey)) {
            allPlayersHaveChosen = false;
            errorMsgElement.textContent = `錯誤提示: 角色 "${characterSettings[selectedCharKey].name}" 已被重複選擇，請更換`;
            break;
        }
        playerCharacterSelections[playerID] = selectedCharKey; // 儲存key
        chosenCharacterKeys.add(selectedCharKey);
    }

    if (allPlayersHaveChosen) {
        document.getElementById('startButton').disabled = false;
        errorMsgElement.textContent = '角色確認: 所有玩家選擇完畢！可開始遊戲。';
        errorMsgElement.style.color = 'green';
        document.getElementById('confirmCharactersButton').classList.add('selected');
        for (let i = 0; i < selectedPlayerCount; i++) {
            const playerID = PLAYER_ID_MAP[i];
            const selectElement = document.getElementById(`characterSelect${playerID}`);
            selectElement.disabled = true
        }
    } else {
        document.getElementById('startButton').disabled = true;
        errorMsgElement.style.color = 'red';
        document.getElementById('confirmCharactersButton').classList.remove('selected');
    }
}

function startGame() {
    if (Object.keys(playerCharacterSelections).length !== selectedPlayerCount || selectedPlayerCount === 0) {
        alert("初始錯誤: 請先完成人數選擇和所有玩家的角色確認");
        return;
    }

    players = PLAYER_ID_MAP.slice(0, selectedPlayerCount); // 設定當前遊戲的玩家列表

    // 初始化玩家技能、時間等
    playerCharacterSkills = {};
    playerTimes = {};
    timeline = {};

    PLAYER_ID_MAP.forEach(pid_map => { // 先隱藏所有可能的玩家區塊
        const playerElement = document.getElementById('player' + pid_map);
        const timelinePlayerElement = document.getElementById('timeline' + pid_map);
        if (playerElement) playerElement.style.display = 'none';
        if (timelinePlayerElement) timelinePlayerElement.style.display = 'none';
    });

    players.forEach(p_id => {
        document.getElementById('player' + p_id).style.display = 'flex'; // 顯示當前玩家的區塊
        document.getElementById('timeline' + p_id).style.display = 'block';

        const selectedCharKey = playerCharacterSelections[p_id]; // 這是角色key, e.g. "1"
        const character = characterSettings[selectedCharKey];

        playerCharacterSkills[p_id] = character.skill ? { ...character.skill } : { type: "NONE" }; // 儲存技能
        playerTimes[p_id] = character.startTime;
        timeline[p_id] = []; // 初始化時間軸

        document.querySelector(`#player${p_id} > h3`).textContent = `${p_id}玩家 (${character.name})`;
        document.querySelector(`#timeline${p_id} > h3`).textContent = `${p_id}玩家 (${character.name}) 時間軸`;
        updateTimeBar(p_id);
    });

    // 切換UI顯示
    document.querySelector('.setup').style.display = 'none';
    document.querySelector('.game-area').style.display = 'block';
    document.getElementById('timeline').style.display = 'block';

    round = 1;
    document.getElementById('roundTitle').textContent = `第${round}回合`;
    document.getElementById('playerActions').style.display = 'none'; // 初始隱藏玩家行動區
    document.getElementById('marketSelection').style.display = 'block'; // 顯示市場選擇區
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';

    drawMarket(); // 準備市場卡片
}
// ========= 市場階段與通用按鈕渲染 =========
function drawMarket() {
    const marketArea = document.getElementById('marketArea');
    marketArea.innerHTML = '';
    selectedMarket = [];

    const maxSelection = determineMaxMarketSelectionCount();
    document.getElementById('marketSelectionTitle').textContent = `市場選卡: 請選擇 ${maxSelection} 張`;

    if (availableCards.length === 0) {
        marketArea.innerHTML = '<p class="market-status-text">市場提示: 所有卡片已用盡！</p>';
        document.getElementById('confirmMarket').disabled = true;
        return;
    }
    if (maxSelection === 0 && availableCards.length > 0) {
         marketArea.innerHTML = `<p class="market-status-text">市場提示: 無法形成市場 (需至少 ${selectedPlayerCount + 1} 張，剩餘 ${availableCards.length})</p>`;
         document.getElementById('confirmMarket').disabled = true;
         return;
    }

    // 顯示所有 availableCards 供主持人選擇 (這裡的 availableCards 未排除本回合市場卡，因為是主持人選牌階段)
    availableCards.forEach(cardId => {
        const cardInfo = cardData[cardId];
        if (!cardInfo) { console.error(`市場錯誤:ID ${cardId} 無資料`); return; }
        const btn = document.createElement('button');
        btn.textContent = `${cardInfo.name} (時${cardInfo.price})`;
        btn.dataset.cardId = cardId;
        btn.onclick = () => toggleMarketCard(cardId, btn);
        marketArea.appendChild(btn);
    });
    updateConfirmMarketButtonState();
}

function toggleMarketCard(cardId, btn) {
    const maxSelection = determineMaxMarketSelectionCount();
    const isSelected = selectedMarket.includes(cardId);

    if (isSelected) {
        selectedMarket = selectedMarket.filter(c => c !== cardId);
        btn.classList.remove('selected');
    } else {
        if (selectedMarket.length >= maxSelection) {
            alert(`市場上限: 最多只能選擇 ${maxSelection} 張`);
            return;
        }
        selectedMarket.push(cardId);
        btn.classList.add('selected');
    }
    updateConfirmMarketButtonState();
}

function updateConfirmMarketButtonState() {
    const maxSelection = determineMaxMarketSelectionCount();
    const confirmBtn = document.getElementById('confirmMarket');
    if (availableCards.length === 0 || maxSelection === 0) {
        confirmBtn.disabled = true;
    } else {
        confirmBtn.disabled = selectedMarket.length !== maxSelection;
    }
}

function resetMarketCardSelection() {
    console.log("市場操作: 重設選擇");
    selectedMarket = [];
    drawMarket(); // Re-renders buttons and updates confirm button state
}

function confirmMarket() {
    const maxSelection = determineMaxMarketSelectionCount();
    if (selectedMarket.length !== maxSelection) {
        alert(`市場錯誤: 請選擇剛好 ${maxSelection} 張`);
        return;
    }
    marketCards = [...selectedMarket];
    console.log(`市場處理: 本回合市場卡為 ${marketCards.map(id => cardData[id].name).join(', ')}`);

    document.getElementById('marketSelection').style.display = 'none';
    document.getElementById('playerActions').style.display = 'block';
    document.getElementById('nextRoundBtn').disabled = true;
    document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block';

    players.forEach(p_id => { // 為所有玩家重置行動選擇狀態
        playerActions[p_id] = null;
        playerTurnChoices[p_id] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false };
    });
    marketStep(); // 準備玩家行動階段
}

function backToMarketSelection() {
    console.log("市場操作: 返回市場選卡");
    players.forEach(p_id => {
        playerActions[p_id] = null;
        playerTurnChoices[p_id] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false };
        const actionsArea = document.getElementById('actions' + p_id);
        if (actionsArea) actionsArea.innerHTML = '';
        const manualControls = document.getElementById('manualControls' + p_id);
        if (manualControls) manualControls.style.display = 'none';
    });
    marketCards = []; // 清空已確認的市場卡

    document.getElementById('playerActions').style.display = 'none';
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    document.getElementById('nextRoundBtn').disabled = true;
    drawMarket();
}

// ========= 玩家行動按鈕統一渲染與選擇邏輯 =========
// isFinalizing: true 表示顯示最終確認狀態 (所有按鈕禁用，選中的高亮)
function renderPlayerActionButtons(playerId, isFinalizing = false) {
    const actionButtonsArea = document.getElementById('actions' + playerId);
    actionButtonsArea.innerHTML = ''; // 清空以確保每次都從乾淨的狀態開始渲染

    const skillInfo = playerCharacterSkills[playerId];
    const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";
    const turnState = playerTurnChoices[playerId]; // { actions: [], firstChoiceMade: false, secondChoiceUiActive: false }
    const finalPlayerActions = playerActions[playerId]; // 玩家本回合的最終確認行動

    // 顯示技能6的提示 (如果適用且在選擇階段)
    if (isTwoCardChooser && !isFinalizing && !turnState.secondChoiceUiActive && !turnState.firstChoiceMade) {
        const skillHint = document.createElement('p');
        skillHint.className = 'skill-choice-hint';
        const charName = characterSettings[playerCharacterSelections[playerId]].name;
        skillHint.textContent = `提示: ${charName} 可行動兩次。第一次選卡後可再選一張，或跳過；第一次選休息則結束`;
        skillHint.style.cssText = 'font-size: 0.9em; color: #555; width: 100%; text-align: center; margin-bottom: 10px;';
        actionButtonsArea.appendChild(skillHint);
    }

    // 如果是技能6玩家且已做出第一次卡片選擇 (在第二次選擇界面或最終展示時)
    if (isTwoCardChooser && turnState.firstChoiceMade && turnState.actions.length > 0 && turnState.actions[0] !== '休息') {
        const firstChoiceDisplay = document.createElement('p');
        firstChoiceDisplay.style.cssText = 'width: 100%; text-align: center; margin-bottom: 5px; font-weight: bold;';
        firstChoiceDisplay.textContent = `已選1: ${cardData[turnState.actions[0]].name}`;
        actionButtonsArea.appendChild(firstChoiceDisplay);
    }

    // 生成市場卡片按鈕
    if (marketCards.length > 0) {
        marketCards.forEach((cardId, index) => {
            const cardInfo = cardData[cardId];
            if (!cardInfo) { console.error(`渲染按鈕錯誤: ID ${cardId} 無資料`); return; }

            const btn = document.createElement('button');
            btn.dataset.choice = cardId; // 儲存 cardId
            const estimatedCost = getAdjustedCardCost(playerId, cardInfo.price, 'direct_buy');
            const skillDiscountApplied = estimatedCost < cardInfo.price;
            const costText = skillDiscountApplied ? ` (技${estimatedCost})` : '';
            
            let btnText;
            if (playerTimes[playerId] >= estimatedCost) {
                btnText = `商品${index + 1}:\n ${cardInfo.name}\n(原${cardInfo.price}${costText})`;
            } else {
                btnText = `商品${index + 1}:\n ${cardInfo.name}\n(原${cardInfo.price}${costText} - 時間不足)`;
            }
            btn.textContent = btnText;
            btn.onclick = () => selectAction(playerId, cardId, btn);

            let isDisabled = false;
            let isSelected = false;

            if (isFinalizing) {
                isDisabled = true;
                if (finalPlayerActions && (finalPlayerActions === cardId || (Array.isArray(finalPlayerActions) && finalPlayerActions.includes(cardId)))) {
                    isSelected = true;
                }
            } else if (isTwoCardChooser) {
                if (turnState.secondChoiceUiActive) { // 正在進行第二次選擇
                    if (cardId === turnState.actions[0]) isDisabled = true; // 不能再選第一張
                    else if (playerTimes[playerId] < estimatedCost) isDisabled = true;
                    // 第二張是否已選
                    if (turnState.actions.length === 2 && cardId === turnState.actions[1]) isSelected = true;
                } else if (turnState.firstChoiceMade) { // 第一次已選，但非第二次UI (例如第一次選了休息)
                     isDisabled = true; // 第一次選擇後，若非進入第二次選擇UI，則其他按鈕應禁用
                     if (turnState.actions[0] === cardId) isSelected = true;
                } else { // 正在進行第一次選擇
                    if (playerTimes[playerId] < estimatedCost) isDisabled = true;
                    if (turnState.actions.length === 1 && turnState.actions[0] === cardId) isSelected = true;
                }
            } else { // 標準玩家
                 if (finalPlayerActions) { // 已有最終選擇
                    if (finalPlayerActions === cardId) isSelected = true; else isDisabled = true;
                 } else { // 尚未選擇
                    if (playerTimes[playerId] < estimatedCost) isDisabled = true;
                 }
            }
            btn.disabled = isDisabled;
            if (isSelected) btn.classList.add('selected');
            actionButtonsArea.appendChild(btn);
        });
    } else if (!isFinalizing) { // 市場無卡且非最終展示，提示一下
        actionButtonsArea.innerHTML += '<p class="market-status-text">行動提示: 本回合市場無卡可選</p>';
    }


    // 生成休息按鈕
    const restBtn = document.createElement('button');
    restBtn.dataset.choice = '休息';
    restBtn.textContent = '休息';
    restBtn.onclick = () => selectAction(playerId, '休息', restBtn);

    if (isFinalizing) {
        restBtn.disabled = true;
        if (finalPlayerActions && (finalPlayerActions === '休息' || (Array.isArray(finalPlayerActions) && finalPlayerActions.includes('休息')))) {
            restBtn.classList.add('selected');
        }
    } else if (isTwoCardChooser) {
        if (turnState.secondChoiceUiActive) restBtn.disabled = true; // 第二次不能選休息
        else if (turnState.firstChoiceMade && turnState.actions[0] !== '休息') {
             // 如果第一次選了卡，則"休息"按鈕在第二次選擇界面不應出現或應禁用
             // 目前的邏輯是第二次選擇時，只會有卡片和 "跳過"
             // 但為保險起見，若它還在DOM裡，則禁用
             restBtn.disabled = true;
        }
        if (turnState.actions.length === 1 && turnState.actions[0] === '休息') restBtn.classList.add('selected');
    } else { // 標準玩家
        if (finalPlayerActions) {
            if (finalPlayerActions === '休息') restBtn.classList.add('selected'); else restBtn.disabled = true;
        }
    }
    actionButtonsArea.appendChild(restBtn);

    // 為技能6玩家生成 "跳過第二次選擇" 按鈕 (如果適用)
    if (isTwoCardChooser && turnState.secondChoiceUiActive && !isFinalizing) {
        const skipBtn = document.createElement('button');
        skipBtn.dataset.choice = 'SKIP_SECOND_CHOICE';
        skipBtn.textContent = '完成選擇 (不選第二張)';
        skipBtn.onclick = () => selectAction(playerId, 'SKIP_SECOND_CHOICE', skipBtn);
        actionButtonsArea.appendChild(skipBtn);
    }
}

function marketStep() {
    console.log("行動階段: 開始");
    players.forEach(p_id => {
        playerActions[p_id] = null; // 清除上一回合的最終行動
        playerTurnChoices[p_id] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false }; // 初始化/重置選擇狀態
        renderPlayerActionButtons(p_id); // 繪製初始行動按鈕

        const manualControlsContainer = document.getElementById('manualControls' + p_id);
        manualControlsContainer.innerHTML = '';
        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+1 時間';
        plusBtn.onclick = () => adjustPlayerTimeManually(p_id, 1);
        manualControlsContainer.appendChild(plusBtn);
        const minusBtn = document.createElement('button');
        minusBtn.textContent = '-1 時間';
        minusBtn.onclick = () => adjustPlayerTimeManually(p_id, -1);
        manualControlsContainer.appendChild(minusBtn);
        manualControlsContainer.style.display = 'flex';
    });
    checkAllActions();
}

function selectAction(player, choice, clickedButton) {
    const skillInfo = playerCharacterSkills[player];
    const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";
    const turnState = playerTurnChoices[player]; // { actions: [], firstChoiceMade: false, secondChoiceUiActive: false }

    // --- 標準玩家 ---
    if (!isTwoCardChooser) {
        if (playerActions[player] === choice) { // 點擊已選中的，取消選擇
            playerActions[player] = null;
        } else { // 選擇新的
            playerActions[player] = choice;
        }
        renderPlayerActionButtons(player, playerActions[player] !== null); // 如果有選擇則isFinalizing為true (對於單選玩家)
                                                                      // 或者 isFinalizing 應該只在 checkAllActions 後由 nextRound 觸發
                                                                      // 這裡應該是 renderPlayerActionButtons(player, false) 來更新互動按鈕
                                                                      // 然後 checkAllActions 決定是否鎖定
        renderPlayerActionButtons(player); // 重繪以更新按鈕狀態（選中/禁用其他）
        checkAllActions();
        return;
    }

    // --- 技能6 ("藝術家性格的人") 玩家 ---
    if (isTwoCardChooser) {
        if (!turnState.firstChoiceMade) { // 正在進行第一次選擇
            if (turnState.actions.includes(choice)) { // 點擊已選的第一個 -> 取消
                turnState.actions = [];
                // firstChoiceMade 保持 false
            } else { // 選擇一個新的作為第一次選擇
                turnState.actions = [choice];
                turnState.firstChoiceMade = true;
                if (choice === '休息') {
                    playerActions[player] = ['休息']; // 最終行動
                    turnState.secondChoiceUiActive = false;
                    console.log(`行動階段: 玩家 ${player} 選擇休息`);
                    renderPlayerActionButtons(player, true); // isFinalizing = true
                    checkAllActions(); // 檢查是否所有人都完成了
                    return;
                } else { // 第一次選擇是卡片
                    turnState.secondChoiceUiActive = true; // 進入第二次選擇的UI狀態
                }
            }
        } else if (turnState.secondChoiceUiActive) { // 正在進行第二次選擇
            if (choice === turnState.actions[0]) { // 點擊的是已選的第一張卡 -> 取消第一次選擇並回到初始狀態
                turnState.actions = [];
                turnState.firstChoiceMade = false;
                turnState.secondChoiceUiActive = false;
                playerActions[player] = null;
                console.log(`行動階段: 玩家 ${player} 取消第一次選擇 ${choice}`);
            } else if (choice === 'SKIP_SECOND_CHOICE') {
                playerActions[player] = [turnState.actions[0]]; // 確認只有第一個選擇
                turnState.secondChoiceUiActive = false;
                console.log(`行動階段: 玩家 ${player} 完成第一次選擇 ${turnState.actions[0]} 並跳過第二次`);
                renderPlayerActionButtons(player, true); // isFinalizing = true
                checkAllActions();
                return;
            } else if (turnState.actions.length === 2 && turnState.actions[1] === choice) { // 取消已選的第二張卡
                turnState.actions.pop(); // 移除第二個選擇
                playerActions[player] = null; // 清空已確認的最終行動
                console.log(`行動階段: 玩家 ${player} 取消第二次選擇 ${choice}`);
                // UI 保持在第二次選擇狀態，但該按鈕不再是 selected
            } else { // 選擇了第二張不同的卡 (或更改第二張卡的選擇)
                 if (turnState.actions.length === 1) { // 如果之前只選了一個（第一個），現在補上第二個
                    if (choice === turnState.actions[0]) { // 防禦: 不能和第一張一樣
                         alert("提示: 不能選擇與第一次相同的卡片作為第二次選擇"); return;
                    }
                    turnState.actions.push(choice);
                 } else if (turnState.actions.length === 2) { // 如果之前選了兩個，現在是更改第二個
                    if (choice === turnState.actions[0]) {
                         alert("提示: 不能選擇與第一次相同的卡片作為第二次選擇"); return;
                    }
                    turnState.actions[1] = choice;
                 }
                playerActions[player] = [...turnState.actions]; // 確認兩個選擇
                turnState.secondChoiceUiActive = false;
                renderPlayerActionButtons(player, true); // isFinalizing = true
                checkAllActions();
                return;
            }
        }
        // 每次技能6玩家點擊後都重繪其按鈕區域以反映當前選擇狀態
        renderPlayerActionButtons(player);
        checkAllActions(); // 檢查是否所有人都完成了
    }
}

function checkAllActions() {
    const allPlayersActed = players.every(p_id => {
        // 玩家是否已行動完畢的判斷標準是 playerActions[p_id] 是否有值 (不再是null)
        return playerActions[p_id] !== null && playerActions[p_id] !== undefined;
    });
    document.getElementById('nextRoundBtn').disabled = !allPlayersActed;
}

function refreshPlayerActionButtons(playerId) {
    // 當玩家時間改變後，重置其選擇並刷新其按鈕的可用性
    playerActions[playerId] = null; // 清除已確認的行動
    if (playerCharacterSkills[playerId] && playerCharacterSkills[playerId].type === "TWO_CARD_CHOICES") {
        playerTurnChoices[playerId] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false }; // 重置技能6的選擇過程
    }
    renderPlayerActionButtons(playerId); // 重新渲染該玩家的按鈕，會根據最新時間判斷可否點擊
    checkAllActions(); // 更新下一回合按鈕狀態
}

function adjustPlayerTimeManually(playerId, amount) {
    if (!players.includes(playerId) || !playerTimes.hasOwnProperty(playerId)) {
        console.warn(`手動調時警告: 無效玩家ID ${playerId}`); return;
    }
    const timeBeforeAdjust = playerTimes[playerId];
    let newTime = playerTimes[playerId] + amount;
    newTime = Math.max(0, Math.min(newTime, MAX_TIME));
    const actualChange = newTime - timeBeforeAdjust;

    if (actualChange !== 0) {
        playerTimes[playerId] = newTime;
        const detailMsg = `手動調時:${actualChange > 0 ? '+' : ''}${actualChange}時 (餘${newTime})`;
        timeline[playerId].push({
            type: 'manual_adjust', subtype: actualChange > 0 ? 'plus' : 'minus',
            detail: detailMsg, timeChange: actualChange, timeAfter: playerTimes[playerId], round: round
        });
        updateTimeBar(playerId);
        // renderTimeline(); // refreshPlayerActionButtons 會間接觸發 renderTimeline (如果需要)
        console.log(`手動調時: 玩家 ${playerId} ${detailMsg}`);
        refreshPlayerActionButtons(playerId); // 手動調時後，刷新按鈕狀態並讓玩家重選
    } else {
        console.log(`手動調時: 玩家 ${playerId} 時間無變化 (已達上下限)`);
    }
}
// ========= 核心遊戲邏輯: 回合進程 =========
async function nextRound() {
    console.log(`回合開始: 第 ${round} 回合`);

    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    players.forEach(p => {
        const manualControls = document.getElementById('manualControls' + p);
        if (manualControls) manualControls.style.display = 'none';
    });


    for (const p of players) {
        const playerActionData = playerActions[p];
        const actionsToCheck = Array.isArray(playerActionData) ? playerActionData : [playerActionData];
        for (const action of actionsToCheck) {
            if (action && action !== '休息' && !cardData[action]) {
                console.error(`嚴重錯誤: 玩家 ${p} 選擇卡片 ${action} 無資料`);
                alert(`錯誤: 卡片 ${action} 無資料！遊戲可能無法繼續`);
                document.getElementById('nextRoundBtn').disabled = true;
                return;
            }
        }
    }

    gameStateBeforeNextRound = {
        playerTimes: JSON.parse(JSON.stringify(playerTimes)),
        timeline: JSON.parse(JSON.stringify(timeline)),
        round: round,
        availableCards: JSON.parse(JSON.stringify(availableCards)),
        marketCards: JSON.parse(JSON.stringify(marketCards))
    };

    const choiceCount = {};
    players.forEach(p => {
        const playerActionData = playerActions[p];
        const actionsToProcess = Array.isArray(playerActionData) ? playerActionData : [playerActionData];
        actionsToProcess.forEach(action => {
            if (action === '休息') {
                const timeBeforeRest = playerTimes[p];
                let recoveryAmount = BASE_REST_RECOVERY_AMOUNT;
                const skillInfo = playerCharacterSkills[p];
                
                if (skillInfo && skillInfo.type === "ENHANCED_REST") {
                    recoveryAmount = skillInfo.value;
                    
                }
                playerTimes[p] = Math.min(playerTimes[p] + recoveryAmount, MAX_TIME);
                const actualRecovery = playerTimes[p] - timeBeforeRest;
                const skillText = (recoveryAmount !== BASE_REST_RECOVERY_AMOUNT && skillInfo) ? `技能休息: ` : '休息回復';

                if (actualRecovery >= 0) { // 即使恢復0也記錄
                    const detailMsg = `${skillText}+${actualRecovery}時 (餘${playerTimes[p]})`;
                    timeline[p].push({
                        type: 'rest', subtype: 'recover', detail: detailMsg,
                        timeChange: actualRecovery, timeAfter: playerTimes[p], round: round
                    });
                    console.log(`${skillText}${p}+${actualRecovery}時 (餘${playerTimes[p]})`);
                }
            } else if (action) { // action is a cardId
                choiceCount[action] = (choiceCount[action] || []).concat(p);
            }
        });
    });

    let biddingWasCancelledByUserAction = false;
    const chosenCardIds = Object.keys(choiceCount).map(id => parseInt(id));
    chosenCardIds.sort((a, b) => {
        const indexA = gameStateBeforeNextRound.marketCards.indexOf(a);
        const indexB = gameStateBeforeNextRound.marketCards.indexOf(b);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1; if (indexB === -1) return -1;
        return indexA - indexB;
    });

    for (const cardId of chosenCardIds) {
        const bidders = choiceCount[cardId];
        const currentCardInfo = cardData[cardId];
        if (!currentCardInfo) { console.error(`NextRound錯誤: 卡片ID ${cardId} 無資料 (在競標迴圈中)`); continue; }

        if (bidders.length === 1) {
            const p = bidders[0];
            const originalPrice = currentCardInfo.price;
            const actualCost = getAdjustedCardCost(p, originalPrice, 'direct_buy');
            const skillActive = actualCost < originalPrice;
            const skillText = skillActive ? ` (技)` : ''; // 簡化技能提示
            const detailMsg = `直接購買: ${currentCardInfo.name} (原${originalPrice},實${actualCost}${skillText})`;

            if (playerTimes[p] >= actualCost) {
                playerTimes[p] -= actualCost;
                timeline[p].push({
                    type: 'buy', subtype: 'direct', detail: detailMsg,
                    timeChange: -actualCost, timeAfter: playerTimes[p], round: round
                });
                console.log(`直接購買: ${p} ${detailMsg}`);
                const indexInAvailable = availableCards.indexOf(cardId);
                if (indexInAvailable > -1) {
                    availableCards.splice(indexInAvailable, 1);
                }
            } else {
                const failDetail = `購買失敗: ${currentCardInfo.name} (需${actualCost},餘${playerTimes[p]})`;
                timeline[p].push({
                    type: 'buy_fail', subtype: 'insufficient_funds_direct', detail: failDetail,
                    timeChange: 0, timeAfter: playerTimes[p], round: round
                });
                console.log(`購買失敗: ${p} ${failDetail}`);
            }
        } else if (bidders.length > 1) {
            console.log(`進入競標: ${currentCardInfo.name} (參與者: ${bidders.join(', ')})`);
            const biddingResultOutcome = await performBiddingProcess(cardId, bidders);

            if (biddingResultOutcome.userCancelled) {
                biddingWasCancelledByUserAction = true; break;
            }
            if (biddingResultOutcome.winner) {
                const indexInAvailable = availableCards.indexOf(cardId);
                if (indexInAvailable > -1) {
                    availableCards.splice(indexInAvailable, 1);
                }
            }
            if (biddingResultOutcome.needsConsolationDraw && biddingResultOutcome.tiedPlayersForConsolation.length > 0) {
                await startConsolationDrawPhase(biddingResultOutcome.tiedPlayersForConsolation);
            }
        }
    }

    if (biddingWasCancelledByUserAction) {
        console.log("回合中止: 競標被使用者取消");
        return; // cancelBidding 應已處理UI和狀態回溯
    }

    const initialMarketCardsThisRound = gameStateBeforeNextRound.marketCards;
    if (initialMarketCardsThisRound && initialMarketCardsThisRound.length > 0) {
        console.log(`回合結束: 清理市場卡`);
        initialMarketCardsThisRound.forEach(cardIdToRemove => {
            const indexInAvailable = availableCards.indexOf(cardIdToRemove);
            if (indexInAvailable > -1) {
                availableCards.splice(indexInAvailable, 1);
            }
        });
    }

    // 技能ID "10": 小熊啾啾 - 回合結束全體加時間
    let skill10Active = players.some(p_id =>
        playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "ROUND_START_TIME_BONUS_ALL"
    );
    if (skill10Active) {
        const skillHolder = players.find(p_id => playerCharacterSkills[p_id]?.type === "ROUND_START_TIME_BONUS_ALL");
        const timeBonusValue = playerCharacterSkills[skillHolder]?.value || 1;
        const skillOwnerName = characterSettings[playerCharacterSelections[skillHolder]].name;

        players.forEach(p_id_to_receive_bonus => {
            const timeBeforeBonus = playerTimes[p_id_to_receive_bonus];
            playerTimes[p_id_to_receive_bonus] = Math.min(playerTimes[p_id_to_receive_bonus] + timeBonusValue, MAX_TIME);
            const actualTimeGained = playerTimes[p_id_to_receive_bonus] - timeBeforeBonus;
            if (actualTimeGained > 0) {
                const detailMsg = `技能調時:${skillOwnerName} (+${actualTimeGained}時間)`;
                timeline[p_id_to_receive_bonus].push({
                    type: 'skill_effect', subtype: 'round_time_bonus',
                    detail: detailMsg, timeChange: actualTimeGained,
                    timeAfter: playerTimes[p_id_to_receive_bonus], round: round
                });
            }
        });
        console.log(`回合事件: 全體 +${timeBonusValue} 時間`);
    }

    round++;
    document.getElementById('roundTitle').textContent = `第 ${round} 回合`;
    playerActions = {};
    players.forEach(p => { playerTurnChoices[p] = { count: 0, actions: [], firstChoiceWasCard: false }; });
    document.getElementById('nextRoundBtn').disabled = true;
    updateAllTimeBars();
    renderTimeline();
    gameStateBeforeNextRound = null;
    console.log(`回合準備: 前進至第 ${round} 回合。可用卡牌剩餘 ${availableCards.length} 張`);

    const marketAreaContainer = document.getElementById('marketArea');
    drawMarket();
    const marketAreaButtons = marketAreaContainer.getElementsByTagName('button');

    if (availableCards.length === 0 && marketAreaButtons.length === 0 && determineMaxMarketSelectionCount() === 0) {
        alert("所有卡片均已處理完畢，遊戲結束");
        const marketSelectionDiv = document.getElementById('marketSelection');
        marketSelectionDiv.innerHTML = '<h2 style="text-align:center; color: blue;">遊戲結束 - 所有卡片已處理</h2>';
        document.getElementById('playerActions').style.display = 'none';
        document.getElementById('nextRoundBtn').disabled = true;
        document.getElementById('backToMarketSelectionBtn').style.display = 'none';
        console.log("遊戲結束: 所有卡片處理完畢");
        return;
    }

    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('playerActions').style.display = 'none';
    // selectedMarket and marketCards are reset/handled by drawMarket and confirmMarket respectively
}
// ========= 競標相關函式 =========
async function performBiddingProcess(cardId, bidders) {
    return new Promise((resolve) => {
        currentBidding = {
            cardId: cardId, bidders: [...bidders], bids: [], step: 0, resolvePromise: resolve,
            needsConsolationDraw: false, tiedPlayersForConsolation: []
        };
        console.log(`競標階段: 開始 ${cardData[cardId]?.name} (參與者: ${bidders.join(', ')})`);
        promptNextBidder();
    });
}

function promptNextBidder() {
    const oldWindow = document.querySelector('.bidding-window');
    if (oldWindow) oldWindow.remove();

    if (currentBidding.step >= currentBidding.bidders.length) {
        resolveBidding(); // 所有人都出過價了
        return;
    }

    const biddingWindow = document.createElement('div');
    biddingWindow.className = 'bidding-window';
    const player = currentBidding.bidders[currentBidding.step];
    const maxBid = playerTimes[player];
    const cardInfoForBid = cardData[currentBidding.cardId];

    if (!cardInfoForBid) {
        console.error(`競標提示錯誤: 卡片ID ${currentBidding.cardId} 無資料`);
        if (currentBidding.resolvePromise) {
            currentBidding.resolvePromise({ userCancelled: true, bidResolvedWithoutConsolation: false, winner: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] });
        }
        currentBidding = { cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };
        return;
    }
    const minBid = cardInfoForBid.price; // 競標底價即為卡片原價
    const playerCharKey = playerCharacterSelections[player];
    const playerCharDisplayName = characterSettings[playerCharKey]?.name || '';

    console.log(`競標提示: 輪到玩家 ${player} (${playerCharDisplayName}) 對 ${cardInfoForBid.name} 出價 (時間 ${maxBid}, 底價 ${minBid})`);
    biddingWindow.innerHTML = `<h3>玩家 ${player} (${playerCharDisplayName}) 出價 (現有時間: ${maxBid})</h3>
                             <p>競標目標: ${cardInfoForBid.name} (原價/最低出價: ${minBid})</p>`;

    if (maxBid >= minBid) {
        for (let bid = minBid; bid <= maxBid; bid++) {
            const bidBtn = document.createElement('button');
            bidBtn.textContent = `出價 ${bid}`;
            bidBtn.onclick = () => handleBid(player, bid);
            biddingWindow.appendChild(bidBtn);
        }
    } else {
        biddingWindow.innerHTML += `<p style="color:red;">提示: 您的時間不足 ${minBid}，無法對此卡片進行最低出價。</p>`;
    }

    const passBtn = document.createElement('button');
    passBtn.textContent = '放棄出價 (Pass)';
    passBtn.style.backgroundColor = '#e57373'; // 淡紅色
    passBtn.onclick = () => handleBid(player, 0); // 出價0代表Pass
    biddingWindow.appendChild(passBtn);

    if (currentBidding.step > 0) {
        const backBtn = document.createElement('button');
        backBtn.textContent = '← 返回上一位';
        backBtn.style.backgroundColor = '#ffb74d'; // 淡橙色
        backBtn.onclick = () => {
            currentBidding.step--;
            // 移除上一個玩家對此卡的最後一次出價記錄
            // 找到 currentBidding.bids 中屬於 playerThatWas = currentBidding.bidders[currentBidding.step] 且 cardId 相符的最後一個
            const playerWhoseBidToRemove = currentBidding.bidders[currentBidding.step];
            let foundAndRemoved = false;
            for(let i = currentBidding.bids.length -1; i >= 0; i--) {
                if(currentBidding.bids[i].player === playerWhoseBidToRemove && currentBidding.bids[i].cardId === currentBidding.cardId) {
                    currentBidding.bids.splice(i, 1);
                    foundAndRemoved = true;
                    console.log(`競標操作: 返回上一步，移除玩家 ${playerWhoseBidToRemove} 的出價`);
                    break;
                }
            }
            if(!foundAndRemoved) console.warn(`競標返回警告: 未找到玩家 ${playerWhoseBidToRemove} 的先前出價記錄。`);
            promptNextBidder();
        };
        biddingWindow.appendChild(backBtn);
    }

    const cancelBtnElement = document.createElement('button');
    cancelBtnElement.textContent = '✖ 取消整輪競標 (回溯)';
    cancelBtnElement.style.backgroundColor = '#90a4ae'; // 藍灰色
    cancelBtnElement.onclick = () => cancelBidding(true); // true 表示完全取消並回溯
    biddingWindow.appendChild(cancelBtnElement);

    document.body.appendChild(biddingWindow);
    biddingWindow.focus();
}

function handleBid(player, bidAmount) {
    // 移除該玩家先前對此卡的所有出價，再加入新的 (確保每個玩家對同一卡只有一個最終出價)
    currentBidding.bids = currentBidding.bids.filter(b => !(b.player === player && b.cardId === currentBidding.cardId));
    currentBidding.bids.push({ player: player, bid: bidAmount, cardId: currentBidding.cardId });
    console.log(`競標處理: 玩家 ${player} 對卡片 ${cardData[currentBidding.cardId]?.name || currentBidding.cardId} 出價 ${bidAmount === 0 ? '放棄' : bidAmount}`);
    currentBidding.step++;
    promptNextBidder();
}

function resolveBidding() {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    const cardIdBeingBidOn = currentBidding.cardId;
    const cardInfo = cardData[cardIdBeingBidOn] || { name: `未知卡片 ${cardIdBeingBidOn}`, price: 0 };
    // 只考慮對當前 cardIdBeingBidOn 的出價
    const relevantBidsForThisCard = currentBidding.bids.filter(b => b.cardId === cardIdBeingBidOn);
    const activeBidsForThisCard = relevantBidsForThisCard.filter(b => b.bid > 0);
    const currentRoundForEvent = gameStateBeforeNextRound ? gameStateBeforeNextRound.round : round;

    let biddingOutcome = {
        userCancelled: false, bidResolvedWithoutConsolation: false, winner: null,
        needsConsolationDraw: false, tiedPlayersForConsolation: []
    };

    if (activeBidsForThisCard.length === 0) {
        const detailMsg = `全員放棄: ${cardInfo.name} (原價 ${cardInfo.price})`;
        // 確保只為參與了本次 cardId 競標的 bidders（即使是放棄）添加事件
        currentBidding.bidders.forEach(p_id => { // currentBidding.bidders 是最初被邀請對此卡出價的人
            const playerMadeABidForThisCard = relevantBidsForThisCard.some(b => b.player === p_id);
            if (playerMadeABidForThisCard) { // 只有實際操作過（包括放棄）的玩家才記錄
                 timeline[p_id].push({
                    type: 'bidding', subtype: 'pass_all', detail: detailMsg,
                    timeChange: 0, timeAfter: playerTimes[p_id], round: currentRoundForEvent
                });
            }
        });
        console.log(`全員放棄: ${detailMsg}`);
        biddingOutcome.bidResolvedWithoutConsolation = true;
    } else {
        let maxBidValue = 0;
        activeBidsForThisCard.forEach(b => { if (b.bid > maxBidValue) maxBidValue = b.bid; });
        const potentialWinnerIds = [...new Set(activeBidsForThisCard.filter(b => b.bid === maxBidValue).map(b => b.player))];

        if (potentialWinnerIds.length === 1) {
            const winner = potentialWinnerIds[0];
            const actualCost = getAdjustedCardCost(winner, maxBidValue, 'bid_win');
            const skillText = actualCost < maxBidValue ? ' [技]' : '';
            const winDetailMsg = `競標成功: ${cardInfo.name} (出價 ${maxBidValue}, 實花 ${actualCost}${skillText})`;

            // 順序調整: 先加 phase_tick
            timeline[winner].push({
                type: 'phase_tick', subtype: 'bid_win_marker',
                detail: `競標事件`, // 簡化
                timeChange: 0, timeAfter: playerTimes[winner], round: currentRoundForEvent // 此時時間尚未扣除
            });
            playerTimes[winner] -= actualCost; // 再扣時間
            timeline[winner].push({ // 再記錄成功事件
                type: 'bidding', subtype: 'win', detail: winDetailMsg,
                timeChange: -actualCost, timeAfter: playerTimes[winner], round: currentRoundForEvent
            });
            console.log(`競標成功: ${winDetailMsg.replace('競標成功: ', `玩家 ${winner} `)}`);

            relevantBidsForThisCard.forEach(({ player: p, bid: bVal }) => {
                if (p !== winner) {
                    const loserDetail = bVal > 0 ? `競標失敗: ${cardInfo.name} (出價 ${bVal})` : `放棄競標: ${cardInfo.name} (未出價)`;
                    const sub = bVal > 0 ? 'lose' : 'pass';
                    timeline[p].push({
                        type: 'bidding', subtype: sub, detail: loserDetail,
                        timeChange: 0, timeAfter: playerTimes[p], round: currentRoundForEvent
                    });
                }
            });
            biddingOutcome.bidResolvedWithoutConsolation = true;
            biddingOutcome.winner = winner;
        } else { // 平手
            console.log(`競標結束: ${cardInfo.name} 平手 (最高 ${maxBidValue}), 參與者: ${potentialWinnerIds.join(', ')}`);
            let skill4Winner = null;
            const playersWithSkill4InTie = potentialWinnerIds.filter(p_id =>
                playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "WIN_BID_TIE"
            );

            if (playersWithSkill4InTie.length === 1) skill4Winner = playersWithSkill4InTie[0];

            if (skill4Winner) {
                const actualCost = getAdjustedCardCost(skill4Winner, maxBidValue, 'bid_win');
                const skillText = actualCost < maxBidValue ? ' [技]' : '';
                const skillWinDetailMsg = `技能勝出: ${cardInfo.name} (出價 ${maxBidValue}, 實花 ${actualCost}${skillText})`;

                // 順序調整: 先加 phase_tick
                timeline[skill4Winner].push({
                    type: 'phase_tick', subtype: 'bid_win_marker',
                    detail: `競標事件: ${cardInfo.name} (技)`, // 簡化
                    timeChange: 0, timeAfter: playerTimes[skill4Winner], round: currentRoundForEvent
                });
                playerTimes[skill4Winner] -= actualCost; // 再扣時間
                timeline[skill4Winner].push({ // 再記錄成功事件
                    type: 'bidding', subtype: 'win_skill', detail: skillWinDetailMsg,
                    timeChange: -actualCost, timeAfter: playerTimes[skill4Winner], round: currentRoundForEvent
                });
                console.log(`競標結束: ${skillWinDetailMsg.replace('技能勝出: ', `玩家 ${skill4Winner} `)}`);

                relevantBidsForThisCard.forEach(({ player: p, bid: bVal }) => {
                    if (p !== skill4Winner) {
                        const detailText = potentialWinnerIds.includes(p) ? `平手技敗: ${cardInfo.name} (出價 ${bVal})` :
                                         (bVal > 0 ? `競標失敗: ${cardInfo.name} (出價 ${bVal})` : `放棄競標: ${cardInfo.name} (未出價)`);
                        const sub_type = potentialWinnerIds.includes(p) ? 'lose_tie_skill' : (bVal > 0 ? 'lose' : 'pass');
                        timeline[p].push({
                            type: 'bidding', subtype: sub_type, detail: detailText,
                            timeChange: 0, timeAfter: playerTimes[p], round: currentRoundForEvent
                        });
                    }
                });
                biddingOutcome.bidResolvedWithoutConsolation = true;
                biddingOutcome.winner = skill4Winner;
            } else { // 無技能解決的平手 -> 流標，觸發抽牌
                const tieDetailMsg = `平局流標: ${cardInfo.name} (出價 ${maxBidValue})`;
                //console.log(`競標事件: ${tieDetailMsg}，準備抽牌階段。`);
                potentialWinnerIds.forEach(p_id => {
                    timeline[p_id].push({
                        type: 'bidding', subtype: 'tie_unresolved', detail: tieDetailMsg,
                        timeChange: 0, timeAfter: playerTimes[p_id], round: currentRoundForEvent
                    });
                });
                biddingOutcome.needsConsolationDraw = true;
                biddingOutcome.tiedPlayersForConsolation = [...potentialWinnerIds];
            }
        }
    }

    if (currentBidding.resolvePromise) {
        currentBidding.resolvePromise(biddingOutcome);
    }
    // currentBidding 重設移至 performBiddingProcess 和 cancelBidding 中，確保 resolvePromise 被調用後執行
}

function cancelBidding(fullCancel = false) {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    const promiseToResolve = currentBidding.resolvePromise;
    const biddingOutcomeOnCancel = { userCancelled: true, bidResolvedWithoutConsolation: false, winner: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };

    if (fullCancel && gameStateBeforeNextRound) {
        console.log("競標取消: 完全回溯至行動選擇點");
        playerTimes = gameStateBeforeNextRound.playerTimes;
        timeline = gameStateBeforeNextRound.timeline;
        round = gameStateBeforeNextRound.round; // 理論上競標取消不應跨回合，但以防萬一
        availableCards = gameStateBeforeNextRound.availableCards;
        marketCards = gameStateBeforeNextRound.marketCards; // 回溯本回合市場牌

        playerActions = {}; // 清空所有玩家已選行動
        players.forEach(p => { playerTurnChoices[p] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false }; });

        document.getElementById('roundTitle').textContent = `第 ${round} 回合`;
        document.getElementById('nextRoundBtn').disabled = true;
        document.getElementById('marketSelection').style.display = 'none';
        document.getElementById('playerActions').style.display = 'block';
        document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block';
        marketStep(); // 重生成行動按鈕
        updateAllTimeBars();
        renderTimeline(); // 渲染回溯後的時間軸
    }

    if (promiseToResolve) {
        promiseToResolve(biddingOutcomeOnCancel);
    }
    currentBidding = { cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };
    if (fullCancel) gameStateBeforeNextRound = null; // 狀態已使用或回溯，清除
}

// ========= 抽牌/購買階段 =========
async function startConsolationDrawPhase(tiedPlayersList) {
    console.log(`抽牌階段: 開始 (參與者: ${tiedPlayersList.join(', ')})`);
    const sortedTiedPlayers = tiedPlayersList.sort((a, b) => PLAYER_ID_MAP.indexOf(a) - PLAYER_ID_MAP.indexOf(b));

    // 1. 創建本輪抽牌的專用可選卡池 (排除本回合已在市場上出現過的卡片)
    let consolationSelectableCards = availableCards.filter(
        cardId => !(gameStateBeforeNextRound.marketCards.includes(cardId))
    );

    for (const player of sortedTiedPlayers) {
        if (consolationSelectableCards.length === 0) {
            console.log(`抽牌結束: 無卡可選，可選池已空`);
            timeline[player].push({
                type: 'phase_info', subtype: 'consolation_no_cards', // 使用 phase_info 表示一個通知性事件
                detail: noCardDetail,
                timeChange: 0, timeAfter: playerTimes[player], round: round
            });
            // 由於池已空，後續玩家也不會有卡，但讓迴圈自然結束或在這裡 break
            // 如果希望所有後續玩家都收到 "無卡可選" 通知，則不 break
            // 但如果一個 break，後面的人就不會收到通知了。所以這裡應該 continue，讓每個玩家都有機會記錄
            // update: 如果 consolationSelectableCards 在迴圈外判斷一次即可，這裡直接 break
            // 但為了每個玩家都有事件，還是逐個判斷
            // update2: 由於 consolationSelectableCards 在迴圈內被修改，所以每次都要檢查。
            // 如果第一個玩家抽完後池子空了，那第二個玩家就直接進入這個if。
        } else {
            console.log(`抽牌提示: 輪到玩家 ${player} 選擇`);
            // 2. 玩家從過濾後的專用池中選擇一張
            // 傳遞 consolationSelectableCards 的副本，以防 promptConsolationCardChoice 意外修改原陣列
            const chosenCardId = await promptConsolationCardChoice(player, [...consolationSelectableCards]);

            if (!chosenCardId) {
                console.log(`抽牌處理: 玩家 ${player} 放棄抽牌`);
                const skipDetail = `抽牌選擇: 放棄`; // 新格式
                timeline[player].push({
                    type: 'draw_decline', subtype: 'consolation_choice_skip', detail: skipDetail,
                    timeChange: 0, timeAfter: playerTimes[player], round: round
                });
                // 放棄選擇，不消耗卡片，繼續輪到下一位玩家
                // consolationSelectableCards 和 availableCards 在此情況下不變
            } else {
                // 3. 一旦卡片被選中（即使還未決定購買），就從各個相關列表中移除
                // a. 從本輪抽牌的後續選項中移除 (確保其他平手玩家不能再選此卡)
                consolationSelectableCards = consolationSelectableCards.filter(id => id !== chosenCardId);
                // b. 從全域的 availableCards 中移除 (代表該卡片已被"揭示/消耗"，不論是否購買)
                const indexInGlobalAvailable = availableCards.indexOf(chosenCardId);
                if (indexInGlobalAvailable > -1) {
                    availableCards.splice(indexInGlobalAvailable, 1);
                } else {
                    // 理論上不應發生，因為 consolationSelectableCards 是 availableCards 的子集
                    console.warn(`安慰階段警告: 卡片 ${chosenCardId} 被選中，但未在主牌庫找到？！`);
                }

                const chosenCardInfo = cardData[chosenCardId];
                if (!chosenCardInfo) { // 防禦性檢查
                     console.error(`安慰階段錯誤: 玩家 ${player} 選擇的卡片ID ${chosenCardId} 無有效資料 (在cardData中未找到)。卡片已消耗。`);
                     // 雖然卡片資料找不到，但它已從 availableCards 移除
                     timeline[player].push({
                         type: 'error_event', subtype: 'consolation_card_data_missing',
                         detail: `系統錯誤: 卡片 ${chosenCardId} 資料遺失`,
                         timeChange: 0, timeAfter: playerTimes[player], round: round
                     });
                     continue; // 進行到下一位玩家
                }

                const originalPrice = chosenCardInfo.price;
                const actualCost = getAdjustedCardCost(player, originalPrice, 'consolation_draw');
                const wantsToBuy = await promptConsolationPurchase(player, chosenCardInfo, actualCost);

                if (wantsToBuy && playerTimes[player] >= actualCost) {
                    playerTimes[player] -= actualCost;
                    const skillText = actualCost < originalPrice ? ' [技]' : '';
                    const detailMsg = `抽牌獲得: ${chosenCardInfo.name} (原${originalPrice},實${actualCost}${skillText})`; // 新格式
                    timeline[player].push({
                        type: 'draw_acquire', subtype: 'consolation_purchase', detail: detailMsg,
                        timeChange: -actualCost, timeAfter: playerTimes[player], round: round
                    });
                    console.log(`抽牌處理: ${player} 購買獲得 ${chosenCardInfo.name} (原${originalPrice},實${actualCost}${skillText})`);
                    // 卡片已在選中考慮時從 availableCards 移除
                } else {
                    const reason = (wantsToBuy && playerTimes[player] < actualCost) ? '時間不足' : '放棄購買';
                    const detailMsg = `放棄抽牌: ${chosenCardInfo.name} (${reason})`; // 新格式
                    timeline[player].push({
                        type: 'draw_decline', subtype: 'consolation_purchase_decline', detail: detailMsg,
                        timeChange: 0, timeAfter: playerTimes[player], round: round
                    });
                    console.log(`抽牌處理: ${player} 放棄抽牌`);
                }
            }
        }
        updateTimeBar(player); // 在每個玩家操作後更新其時間條
    }
}

async function promptConsolationCardChoice(player, cardsForChoice) { // cardsForChoice 是已過濾的可選牌池
    return new Promise(resolve => {
        const oldWindow = document.querySelector('.consolation-choice-window');
        if (oldWindow) oldWindow.remove();

        if (!cardsForChoice || cardsForChoice.length === 0) {
            resolve(null); // 沒有卡片可以選擇
            return;
        }

        const windowDiv = document.createElement('div');
        windowDiv.className = 'bidding-window consolation-choice-window';
        const playerCharKey = playerCharacterSelections[player];
        const playerCharDisplayName = characterSettings[playerCharKey]?.name || '';
        const charNameForTitle = playerCharDisplayName ? `(${playerCharDisplayName})` : '';

        windowDiv.innerHTML = `<h3>玩家 ${player} ${charNameForTitle} - 安慰卡選擇</h3>
                             <p>請從下列剩餘卡片中選擇一張進行考慮: </p>`;
        const cardListDiv = document.createElement('div');
        cardListDiv.style.cssText = 'max-height: 300px; overflow-y: auto; margin-bottom: 15px; border: 1px solid #eee; padding: 5px;';

        cardsForChoice.forEach(cardId => {
            const cardInfo = cardData[cardId];
            if (!cardInfo) {console.error(`安慰選擇提示錯誤: 卡片ID ${cardId} 無資料`); return;}
            const btn = document.createElement('button');
            btn.textContent = `${cardInfo.name} (原價: ${cardInfo.price})`;
            btn.style.cssText = 'display: block; margin: 8px auto; width: 90%;';
            btn.onclick = () => { windowDiv.remove(); resolve(cardId); };
            cardListDiv.appendChild(btn);
        });
        windowDiv.appendChild(cardListDiv);

        const passButton = document.createElement('button');
        passButton.textContent = '放棄選擇任何卡片';
        passButton.style.marginTop = '10px';
        passButton.onclick = () => { windowDiv.remove(); resolve(null); };
        windowDiv.appendChild(passButton);
        document.body.appendChild(windowDiv);
        windowDiv.focus();
    });
}

async function promptConsolationPurchase(player, cardInfoToPurchase, actualCost) {
    return new Promise(resolve => {
        const oldWindow = document.querySelector('.consolation-purchase-window');
        if (oldWindow) oldWindow.remove();
        const windowDiv = document.createElement('div');
        windowDiv.className = 'bidding-window consolation-purchase-window';
        const playerCharKey = playerCharacterSelections[player];
        const playerCharDisplayName = characterSettings[playerCharKey]?.name || '';
        const charNameForTitle = playerCharDisplayName ? `(${playerCharDisplayName})` : '';

        // 確保 cardInfoToPurchase 是完整的物件，如果不是，嘗試從 cardData 查找
        let displayCardInfo = cardInfoToPurchase;
        if (!displayCardInfo.id || !displayCardInfo.effect) { // 假設 id 和 effect 是 cardData 中物件的標準欄位
            const foundCard = Object.values(cardData).find(c => c.name === cardInfoToPurchase.name && c.price === cardInfoToPurchase.price);
            if (foundCard) displayCardInfo = foundCard;
        }


        windowDiv.innerHTML = `
            <h3>玩家 ${player} ${charNameForTitle} - 購買</h3>
            <p style="font-weight:bold; font-size: 1.1em;">您選擇了: ${displayCardInfo.name} ${displayCardInfo.id ? `(ID: ${displayCardInfo.id})`: ''}</p>
            <p><em>效果: ${displayCardInfo.effect || '無特殊效果描述'}</em></p>
            <p>原價: ${displayCardInfo.price}, 您的花費: <strong style="color: #d32f2f;">${actualCost}</strong></p>
            <p>您目前時間: ${playerTimes[player]}</p>`;

        const buyButton = document.createElement('button');
        buyButton.textContent = `確認購買 (花費 ${actualCost})`;
        if (playerTimes[player] < actualCost) {
            buyButton.disabled = true; buyButton.title = "時間不足";
        }
        buyButton.onclick = () => { windowDiv.remove(); resolve(true); };

        const passButton = document.createElement('button');
        passButton.textContent = '放棄購買此卡';
        passButton.style.backgroundColor = '#ffb74d'; // 淡橙色提示
        passButton.onclick = () => { windowDiv.remove(); resolve(false); };

        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.marginTop = '15px';
        buttonsContainer.appendChild(buyButton); buttonsContainer.appendChild(passButton);
        windowDiv.appendChild(buttonsContainer);
        document.body.appendChild(windowDiv);
        windowDiv.focus();
    });
}

// ========= UI 更新函式 =========
function updateTimeBar(player) {
    if (!playerTimes.hasOwnProperty(player)) {
        console.warn(`時間條警告: 玩家 ${player} 無時間資料`);
        return;
    }
    const time = playerTimes[player];
    const barInner = document.getElementById('bar' + player);
    if (!barInner) {
        console.warn(`時間條警告: 找不到玩家 ${player} 的bar元素`);
        return;
    }

    const percentage = Math.max(0, (time / MAX_TIME * 100));
    barInner.style.width = percentage + '%';
    barInner.textContent = time; // 直接顯示數字

    // 根據時間改變顏色
    if (time <= 0) {
        barInner.style.background = '#424242'; // 深灰 (時間耗盡)
        barInner.textContent = '耗盡';
        barInner.classList.add('empty');
    } else if (time <= MAX_TIME * (1 / 3)) { // 例如 12 * 1/3 = 4
        barInner.style.background = '#d32f2f'; // 紅色 (危險)
        barInner.classList.remove('empty');
    } else if (time <= MAX_TIME * (2 / 3)) { // 例如 12 * 2/3 = 8
        barInner.style.background = '#ff9800'; // 橙色 (警告)
        barInner.classList.remove('empty');
    } else {
        barInner.style.background = '#4caf50'; // 綠色 (安全)
        barInner.classList.remove('empty');
    }
}

function updateAllTimeBars() {
    players.forEach(p_id => updateTimeBar(p_id));
}

let topZIndex = 100;
function renderTimeline() {
    players.forEach(p_id => {
        const eventsDiv = document.getElementById('events' + p_id);
        if (!eventsDiv) return;
        eventsDiv.innerHTML = '';

        if (!timeline[p_id] || timeline[p_id].length === 0) {
            return;
        }

        timeline[p_id].forEach((event,index) => {
            const segment = document.createElement('div');
            segment.className = 'event';
            if (event.type) segment.classList.add(String(event.type).toLowerCase());
            if (event.subtype) segment.classList.add(String(event.subtype).toLowerCase());

            let calculatedWidthPx = MIN_EVENT_SEGMENT_WIDTH;
            const timeChangeNum = Number(event.timeChange);
            if (!isNaN(timeChangeNum) && timeChangeNum !== 0) {
                calculatedWidthPx = Math.abs(timeChangeNum) * TIME_UNIT_WIDTH;
            }
            calculatedWidthPx = Math.max(calculatedWidthPx, MIN_EVENT_SEGMENT_WIDTH);
            segment.style.width = calculatedWidthPx + 'px';
            segment.style.height = EVENT_SEGMENT_HEIGHT;

            let symbol = '?'; // 預設符號
            const type = String(event.type).toLowerCase();
            const subtype = String(event.subtype).toLowerCase();

            if (type === 'rest') symbol = '休';
            else if (type === 'buy') symbol = '購';
            else if (type === 'buy_fail') symbol = 'X';
            else if (type === 'bidding') {
                if (subtype === 'win' || subtype === 'win_skill') symbol = '標✓';
                else if (subtype === 'tie_unresolved' || subtype === 'tie_fail') symbol = '平';
                else if (subtype === 'pass_all') symbol = '全棄';
                else if (subtype === 'pass') symbol = '過';
                else if (subtype === 'lose' || subtype === 'lose_tie_skill') symbol = '標X';
                else symbol = '競'; // 未明確 subtype 的 bidding 事件
            } else if (type === 'phase_tick') {
                if (subtype === 'bid_win_marker') symbol = ' '; // 勝利者競標註記的特殊符號
                else symbol = '●'; // 其他 phase_tick
            } else if (type === 'phase_info') symbol = 'i'; // 資訊性事件
            else if (type === 'skill_effect') symbol = '技';
            else if (type === 'draw_acquire') symbol = '抽✓'; // 抽牌獲得
            else if (type === 'draw_decline') symbol = '抽X'; // 抽牌放棄/失敗
            else if (type === 'manual_adjust') {
                symbol = subtype === 'plus' ? '➕' : '➖';
            } else if (type === 'error_event') {
                symbol = '⚠'; // 系統錯誤事件
            }
            segment.textContent = symbol;

            const tip = document.createElement('div');
            tip.className = 'tooltip ' + (index % 2 === 0 ? 'tooltip-top' : 'tooltip-bottom');
            let detailStr = event.detail || "(無詳細)";
            let roundStr = (event.round !== undefined) ? `(R${event.round}) ` : "";
            let timeChangeDisplay = "";
            if (event.timeChange !== undefined && event.timeChange !== null && !isNaN(event.timeChange)) {
                if (event.timeChange !== 0) { // 只在時間有實際變化時顯示 "→ ±X 時"
                    timeChangeDisplay = ` → ${event.timeChange > 0 ? '+' : ''}${event.timeChange} 時`;
                }
            }
            const timeAfterStr = (event.timeAfter === undefined || event.timeAfter === null || isNaN(event.timeAfter)) ? 'N/A' : event.timeAfter;
            tip.innerText = `${roundStr}${detailStr}${timeChangeDisplay} (餘 ${timeAfterStr})`;
            segment.appendChild(tip);

            segment.onclick = () => { 
                segment.classList.toggle('enlarged');
                topZIndex++;
                segment.style.zIndex = topZIndex;
            };
            eventsDiv.appendChild(segment);
        });
    });
}

// ========= 其他函式 =========
function downloadConsoleLog() {
    // 格式化捕獲到的日誌條目
    const formattedLog = consoleHistory.map(entry => {
        const message = entry.args.join(' '); // 將單條日誌的多個參數合併
        return `${message}`;
    });
    const logContent = formattedLog.join('\n');

    // 建立並開啟一個新的視窗來顯示日誌
    const logWindow = window.open('', '_blank', 'width=800,height=600,scrollbars=yes,resizable=yes');

    if (logWindow) {
        try {
            logWindow.document.write(`
                <!DOCTYPE html>
                <html lang="zh-Hant">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>遊戲紀錄</title>
                    <style>
                        body { 
                            font-family: 'Courier New', Courier, monospace; /* 等寬字體更適合日誌 */
                            white-space: pre-wrap; 
                            padding: 20px; 
                            line-height: 1.6; 
                            background-color: #1e1e1e; /* 暗色背景 */
                            color: #d4d4d4; /* 亮色文字 */
                            font-size: 14px;
                            margin: 0;
                        }
                        .log-header {
                            background-color: #333;
                            color: #fff;
                            padding: 10px 20px;
                            font-size: 1.2em;
                            position: sticky;
                            top: 0;
                            z-index: 10;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        .log-header h1 {
                            margin: 0;
                            font-size: 1.2em;
                        }
                        .controls button {
                            padding: 8px 15px;
                            background-color: #555;
                            color: #fff;
                            border: none;
                            border-radius: 4px;
                            cursor: pointer;
                            font-size: 0.9em;
                            margin-left: 10px;
                        }
                        .controls button:hover {
                            background-color: #777;
                        }
                        pre {
                            margin-top: 0; /* 移除 pre 標籤的預設上邊距 */
                        }
                    </style>
                </head>
                <body>
                    <div class="log-header">
                        <h1>遊戲紀錄</h1>
                        <div class="controls">
                            <button onclick="window.print()">列印</button>
                            <button onclick="window.close()">關閉視窗</button>
                        </div>
                    </div>
                    <pre>${logContent.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre> </body>
                </html>
            `);
            logWindow.document.close(); // 完成寫入
            logWindow.focus(); // 將焦點移至新視窗
            console.info("遊戲紀錄: 已成功在新視窗開啟。");
        } catch (e) {
            console.error("遊戲紀錄錯誤: 無法寫入新視窗內容。", e);
            alert('錯誤: 無法在新視窗中顯示遊戲紀錄。可能是因為彈出視窗被阻擋或發生其他錯誤');
            logWindow.close(); // 嘗試關閉可能部分開啟的視窗
        }
    } else {
        console.warn('遊戲紀錄警告: 無法開啟新視窗。請檢查瀏覽器的彈出視窗設定');
        alert('無法開啟新的紀錄視窗，請檢查您的瀏覽器是否允許彈出式視窗');
    }
}

// =================================================================================
// Script.js 結束
// =================================================================================