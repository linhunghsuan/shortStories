// =================================================================================
// Script.js - 故事卡競拍遊戲記錄 (整合版 - 初步訊息格式修改)
// =================================================================================

const consoleHistory = []; // 用於儲存所有被捕獲的 console 訊息

// 覆寫 console 的主要方法以捕獲日誌
['log', 'info', 'warn', 'error', 'debug'].forEach(method => {
    const originalConsoleMethod = console[method];
    console[method] = function (...args) {
        consoleHistory.push({
            method: method,
            args: args.map(arg => {
                if (typeof arg === 'object' && arg !== null) {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch (e) {
                        return '[Unserializable Object]';
                    }
                }
                return String(arg);
            }),
            timestamp: new Date().toISOString()
        });
        originalConsoleMethod.apply(console, args);
    };
});

// ========= 全域遊戲狀態變數 =========
let gameStateBeforeNextRound = null;
let currentBidding = {
    cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null,
    needsConsolationDraw: false, tiedPlayersForConsolation: []
};
let players = [];
const PLAYER_ID_MAP = ['A', 'B', 'C'];
let playerTimes = {};
let playerActions = {};
let playerCharacterSelections = {};
let playerCharacterSkills = {};
let playerTurnChoices = {};

let marketCards = [];
let selectedMarket = [];
let timeline = {};

let round = 1;
let selectedPlayerCount = 0;

// ========= 常數與資料設定 =========
let cardData = null;
let characterSettings = null;
let characterNames = [];

const MAX_TIME = 12;
const BASE_REST_RECOVERY_AMOUNT = 6;

const TIME_UNIT_WIDTH = 40;
const MIN_EVENT_SEGMENT_WIDTH = TIME_UNIT_WIDTH; // 至少與一個時間單位等寬
const EVENT_SEGMENT_HEIGHT = '25px';

let availableCards = [];

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

        console.info(`應用程式初始化: 成功載入 ${Object.keys(cardData).length} 張卡片資料，${characterNames.length} 種角色設定。`);

        document.getElementById('player1').disabled = false;
        document.getElementById('player2').disabled = false;
        document.getElementById('player3').disabled = false;
        document.getElementById('startButton').disabled = true;

    } catch (error) {
        console.error(`應用程式初始化: 錯誤 - ${error.message}`, error.stack); // Log 包含堆疊追蹤
        alert(`初始化錯誤: 無法載入遊戲設定檔 (${error.message})。\n請檢查控制台以獲取詳細錯誤，並確認 JSON 檔案路徑與內容。`);
    }
}
document.addEventListener('DOMContentLoaded', initializeAppData);

// ========= 輔助函式 =========
function determineMaxMarketSelectionCount() {
    let marketSize = selectedPlayerCount + 1;
    const skill8Player = players.find(p_id =>
        playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "EXTRA_MARKET_CARD"
    );
    if (skill8Player) {
        marketSize++;
        const skillUserCharName = characterSettings[playerCharacterSelections[skill8Player]]?.name || '未知角色';
        console.info(`市場調整: 玩家 [${skill8Player}] (${skillUserCharName}) 技能 "眼光獨到的人" 生效，市場卡片上限 +1。`);
    }
    const finalMarketSize = Math.min(marketSize, availableCards.length);
    // console.debug(`市場調整: 計算後市場卡片上限為 ${finalMarketSize} (玩家數 ${selectedPlayerCount}, 基礎 ${selectedPlayerCount + 1}, 技能加成 ${skill8Player ? '+1' : '+0'}, 可用卡 ${availableCards.length})`);
    return finalMarketSize;
}

function getAdjustedCardCost(playerId, basePrice, purchaseContext) {
    let finalPrice = basePrice;
    const skillInfo = playerCharacterSkills[playerId];
    let skillAppliedDescription = "";

    if (skillInfo) {
        const charName = characterSettings[playerCharacterSelections[playerId]]?.name || '未知角色';
        if (skillInfo.type === "REDUCE_COST_GENERAL") {
            finalPrice -= skillInfo.value;
            skillAppliedDescription = `玩家 [${playerId}] (${charName}) 技能 "嘗試新奇事物的人" 生效，花費 -${skillInfo.value}。`;
        } else if (skillInfo.type === "REDUCE_COST_CONSOLATION_DRAW" && purchaseContext === 'consolation_draw') {
            finalPrice -= skillInfo.value;
            skillAppliedDescription = `玩家 [${playerId}] (${charName}) 技能 "堅定志向的人" 生效 (抽牌)，花費 -${skillInfo.value}。`;
        }
    }
    const adjustedPrice = Math.max(0, finalPrice);
    if (skillAppliedDescription && basePrice !== adjustedPrice) {
        console.info(`成本調整: ${skillAppliedDescription} 卡片原價 ${basePrice}，調整後 ${adjustedPrice}。`);
    }
    return adjustedPrice;
}

// ========= 設定階段函式 =========
function selectPlayerCountUI(count) {
    if (!characterSettings || characterNames.length === 0) {
        alert(`設定錯誤: 角色資料載入失敗或仍在進行中，請稍候再試。`);
        return;
    }
    const playerOptionsButtons = document.querySelectorAll('.player-options button');
    const clickedButton = document.getElementById(`player${count}`);
    const errorMsgElement = document.getElementById('characterSelectionError');
    errorMsgElement.textContent = '';

    if (selectedPlayerCount === count) {
        selectedPlayerCount = 0;
        playerCharacterSelections = {};
        displayCharacterSelection(0);
        playerOptionsButtons.forEach(btn => {
            btn.classList.remove('selected');
            btn.disabled = false;
        });
        document.getElementById('confirmCharactersButton').disabled = true;
        document.getElementById('startButton').disabled = true;
        console.info(`遊戲設定: 操作 - 取消選擇玩家人數。`);
    } else {
        selectedPlayerCount = count;
        playerCharacterSelections = {};
        playerOptionsButtons.forEach(btn => {
            btn.classList.remove('selected');
            btn.disabled = (btn !== clickedButton);
        });
        clickedButton.classList.add('selected');
        displayCharacterSelection(count);
        document.getElementById('confirmCharactersButton').disabled = false;
        document.getElementById('confirmCharactersButton').classList.remove('selected'); // 確保確認按鈕不是已選中狀態
        document.getElementById('startButton').disabled = true;
        console.info(`遊戲設定: 操作 - 選擇玩家人數為 ${count} 人。`);
    }
}

function displayCharacterSelection(playerCount) {
    const container = document.getElementById('characterSelectorsContainer');
    container.innerHTML = '';
    const uiWrapper = document.getElementById('characterSelectionUI');
    const errorMsgElement = document.getElementById('characterSelectionError');
    errorMsgElement.textContent = '';

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
            select.innerHTML = '<option value="">--請選擇角色--</option>';

            characterNames.forEach(charKey => {
                const character = characterSettings[charKey];
                const option = document.createElement('option');
                option.value = charKey;
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
    playerCharacterSelections = {};
    let allPlayersHaveChosen = true;
    const chosenCharacterKeys = new Set();
    const errorMsgElement = document.getElementById('characterSelectionError');
    errorMsgElement.textContent = '';

    for (let i = 0; i < selectedPlayerCount; i++) {
        const playerID = PLAYER_ID_MAP[i];
        const selectElement = document.getElementById(`characterSelect${playerID}`);
        const selectedCharKey = selectElement.value;

        if (!selectedCharKey) {
            allPlayersHaveChosen = false;
            errorMsgElement.textContent = `角色選擇錯誤: 玩家 [${playerID}] 尚未選擇角色。`;
            break;
        }
        if (chosenCharacterKeys.has(selectedCharKey)) {
            allPlayersHaveChosen = false;
            const charName = characterSettings[selectedCharKey]?.name || '未知角色';
            errorMsgElement.textContent = `角色選擇錯誤: 角色 [${charName}] 已被重複選擇，請更換。`;
            break;
        }
        playerCharacterSelections[playerID] = selectedCharKey;
        chosenCharacterKeys.add(selectedCharKey);
    }

    if (allPlayersHaveChosen) {
        document.getElementById('startButton').disabled = false;
        errorMsgElement.textContent = '角色選擇: 確認 - 所有玩家選擇完畢！可以開始遊戲。';
        errorMsgElement.style.color = 'green';
        document.getElementById('confirmCharactersButton').classList.add('selected');
        for (let i = 0; i < selectedPlayerCount; i++) {
            const playerID = PLAYER_ID_MAP[i];
            const selectElement = document.getElementById(`characterSelect${playerID}`);
            selectElement.disabled = true;
        }
        const selectionsForLog = {};
        Object.entries(playerCharacterSelections).forEach(([p, charKey]) => {
            selectionsForLog[p] = characterSettings[charKey]?.name || charKey;
        });
        console.info(`遊戲設定: 角色已確認`);
    } else {
        document.getElementById('startButton').disabled = true;
        errorMsgElement.style.color = 'red'; // Keep error color red
        document.getElementById('confirmCharactersButton').classList.remove('selected');
    }
}

function startGame() {
    if (Object.keys(playerCharacterSelections).length !== selectedPlayerCount || selectedPlayerCount === 0) {
        alert(`開始遊戲錯誤: 請先完成玩家人數及所有角色選擇的確認。`);
        return;
    }

    players = PLAYER_ID_MAP.slice(0, selectedPlayerCount);
    playerCharacterSkills = {};
    playerTimes = {};
    timeline = {};

    console.info(`====== 遊戲開始 (回合 1) ======`);
    console.info(`遊戲設定: 玩家人數 ${selectedPlayerCount}`);

    PLAYER_ID_MAP.forEach(pid_map => {
        const playerElement = document.getElementById('player' + pid_map);
        const timelinePlayerElement = document.getElementById('timeline' + pid_map);
        if (playerElement) playerElement.style.display = 'none';
        if (timelinePlayerElement) timelinePlayerElement.style.display = 'none';
    });

    players.forEach(p_id => {
        document.getElementById('player' + p_id).style.display = 'flex';
        document.getElementById('timeline' + p_id).style.display = 'block';

        const selectedCharKey = playerCharacterSelections[p_id];
        const character = characterSettings[selectedCharKey];

        playerCharacterSkills[p_id] = character.skill ? { ...character.skill } : { type: "NONE" };
        playerTimes[p_id] = character.startTime;
        timeline[p_id] = [];

        console.info(`遊戲設定: 玩家 [${p_id}] 使用角色 [${character.name}] (起始時間: ${playerTimes[p_id]}, 技能: ${playerCharacterSkills[p_id].description || '無'})`);

        document.querySelector(`#player${p_id} > h3`).textContent = `${p_id}玩家 (${character.name})`;
        document.querySelector(`#timeline${p_id} > h3`).textContent = `${p_id}玩家 (${character.name}) 時間軸`;
        updateTimeBar(p_id);
    });
    
    console.info(`遊戲流程: 初始可用卡牌 ${availableCards.length} 張。`);

    document.querySelector('.setup').style.display = 'none';
    document.querySelector('.game-area').style.display = 'block';
    document.getElementById('timeline').style.display = 'block';

    round = 1;
    document.getElementById('roundTitle').textContent = `第${round}回合`;
    document.getElementById('playerActions').style.display = 'none';
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';

    drawMarket();
}

// ========= 市場階段與通用按鈕渲染 =========
function drawMarket() {
    const marketArea = document.getElementById('marketArea');
    marketArea.innerHTML = '';
    selectedMarket = []; // 清空上一輪的市場選擇

    const maxSelection = determineMaxMarketSelectionCount();
    document.getElementById('marketSelectionTitle').textContent = `市場選卡: 請選擇 ${maxSelection} 張`;
    console.info(`市場選卡階段: 主持人需選擇 ${maxSelection} 張卡片作為本回合市場商品 (從 ${availableCards.length} 張剩餘卡片中)。`);

    if (availableCards.length === 0) {
        marketArea.innerHTML = '<p class="market-status-text">市場提示: 所有卡片已用盡！</p>';
        document.getElementById('confirmMarket').disabled = true;
        console.warn("市場選卡階段: 已無可用卡片。");
        return;
    }
    if (maxSelection === 0 && availableCards.length > 0) { // 可用卡不足以形成市場
         marketArea.innerHTML = `<p class="market-status-text">市場提示: 可用卡片不足 (需至少 ${selectedPlayerCount + 1} 張，實際剩餘 ${availableCards.length} 張)，無法形成市場</p>`;
         document.getElementById('confirmMarket').disabled = true;
         console.warn(`市場選卡階段: 剩餘卡片 ${availableCards.length} 張，不足以形成 ${maxSelection} 張的市場。`);
         return;
    }

    availableCards.forEach(cardId => {
        const cardInfo = cardData[cardId];
        if (!cardInfo) { console.error(`市場選卡錯誤: 嘗試渲染卡片時，ID [${cardId}] 無對應資料。`); return; }
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
    const cardNameForLog = cardData[cardId]?.name || `ID ${cardId}`;

    if (isSelected) {
        selectedMarket = selectedMarket.filter(c => c !== cardId);
        btn.classList.remove('selected');
        console.info(`市場選卡: 操作 - 主持人取消選擇卡片 [${cardNameForLog}]。`);
    } else {
        if (selectedMarket.length >= maxSelection) {
            alert(`市場選卡上限: 最多只能選擇 ${maxSelection} 張卡片。`);
            return;
        }
        selectedMarket.push(cardId);
        btn.classList.add('selected');
        console.info(`市場選卡: 操作 - 主持人選擇卡片 [${cardNameForLog}]。`);
    }
    updateConfirmMarketButtonState();
}

function updateConfirmMarketButtonState() {
    const maxSelection = determineMaxMarketSelectionCount();
    const confirmBtn = document.getElementById('confirmMarket');
    if (availableCards.length === 0 || maxSelection === 0 && availableCards.length > 0) { // Added condition for not enough cards for market
        confirmBtn.disabled = true;
    } else {
        confirmBtn.disabled = selectedMarket.length !== maxSelection;
    }
}

function resetMarketCardSelection() {
    console.info("市場選卡: 操作 - 主持人重設所有選擇。");
    selectedMarket = [];
    drawMarket();
}

function confirmMarket() {
    const maxSelection = determineMaxMarketSelectionCount();
    if (selectedMarket.length !== maxSelection) {
        alert(`市場選卡錯誤: 請不多不少選擇 ${maxSelection} 張卡片。`);
        return;
    }
    marketCards = [...selectedMarket];
    console.info(`市場選卡: 確認 - 本回合市場商品為 [${marketCards.map(id => cardData[id]?.name || `ID ${id}`).join(', ')}]`);

    document.getElementById('marketSelection').style.display = 'none';
    document.getElementById('playerActions').style.display = 'block';
    document.getElementById('nextRoundBtn').disabled = true;
    document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block';

    players.forEach(p_id => {
        playerActions[p_id] = null;
        playerTurnChoices[p_id] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false };
    });
    marketStep();
}

function backToMarketSelection() {
    console.info("遊戲流程: 操作 - 主持人返回市場選卡階段 (本回合玩家行動將重置)。");
    players.forEach(p_id => {
        playerActions[p_id] = null;
        playerTurnChoices[p_id] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false };
        const actionsArea = document.getElementById('actions' + p_id);
        if (actionsArea) actionsArea.innerHTML = '';
        const manualControls = document.getElementById('manualControls' + p_id);
        if (manualControls) manualControls.style.display = 'none';
    });
    marketCards = [];

    document.getElementById('playerActions').style.display = 'none';
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    document.getElementById('nextRoundBtn').disabled = true;
    drawMarket();
}

// ========= 玩家行動按鈕統一渲染與選擇邏輯 =========
function renderPlayerActionButtons(playerId, isFinalizing = false) {
    const actionButtonsArea = document.getElementById('actions' + playerId);
    actionButtonsArea.innerHTML = '';

    const skillInfo = playerCharacterSkills[playerId];
    const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";
    const turnState = playerTurnChoices[playerId];
    const finalPlayerActions = playerActions[playerId];
    const charName = characterSettings[playerCharacterSelections[playerId]]?.name || '該玩家';


    if (isTwoCardChooser && !isFinalizing && !turnState.secondChoiceUiActive && !turnState.firstChoiceMade) {
        const skillHint = document.createElement('p');
        skillHint.className = 'skill-choice-hint';
        skillHint.textContent = `技能提示: [${charName}] 可行動兩次。第一次選卡後可再選一張，或跳過；第一次選休息則結束。`;
        //skillHint.style.cssText = 'font-size: 0.9em; color: #555; width: 100%; text-align: center; margin-bottom: 10px;';
        actionButtonsArea.appendChild(skillHint);
    }

    if (isTwoCardChooser && turnState.firstChoiceMade && turnState.actions.length > 0 && turnState.actions[0] !== '休息') {
        const firstChoiceDisplay = document.createElement('p');
        //firstChoiceDisplay.style.cssText = 'width: 100%; text-align: center; margin-bottom: 5px; font-weight: bold;';
        const firstCardName = cardData[turnState.actions[0]]?.name || `卡片ID ${turnState.actions[0]}`;
        firstChoiceDisplay.textContent = `已選一: [${firstCardName}]`;
        actionButtonsArea.appendChild(firstChoiceDisplay);
    }

    if (marketCards.length > 0) {
        marketCards.forEach((cardId, index) => {
            const cardInfo = cardData[cardId];
            if (!cardInfo) { console.error(`行動按鈕渲染錯誤: 卡片ID [${cardId}] 無對應資料。`); return; }

            const btn = document.createElement('button');
            btn.dataset.choice = cardId;
            const estimatedCost = getAdjustedCardCost(playerId, cardInfo.price, 'direct_buy');
            const skillDiscountApplied = estimatedCost < cardInfo.price;
            const priceDisplay = skillDiscountApplied ? `原${cardInfo.price}, 技${estimatedCost}` : `時${cardInfo.price}`;

            btn.textContent = `選擇 ${index + 1}: ${cardInfo.name} (${priceDisplay}${playerTimes[playerId] < estimatedCost ? ' - 時間不足' : ''})`;
            btn.onclick = () => selectAction(playerId, cardId, btn);

            let isDisabled = false;
            let isSelected = false;

            if (isFinalizing) {
                isDisabled = true;
                if (finalPlayerActions && (finalPlayerActions === cardId || (Array.isArray(finalPlayerActions) && finalPlayerActions.includes(cardId)))) {
                    isSelected = true;
                }
            } else if (isTwoCardChooser) {
                if (turnState.secondChoiceUiActive) {
                    if (cardId === turnState.actions[0]) isDisabled = true;
                    else if (playerTimes[playerId] < estimatedCost) isDisabled = true;
                    if (turnState.actions.length === 2 && cardId === turnState.actions[1]) isSelected = true;
                } else if (turnState.firstChoiceMade) {
                     isDisabled = true;
                     if (turnState.actions[0] === cardId) isSelected = true;
                } else { // 技能6，第一次選擇
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
    } else if (!isFinalizing) {
        actionButtonsArea.innerHTML += '<p class="market-status-text">行動提示: 本回合市場無卡可選。</p>';
    }

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
        if (turnState.secondChoiceUiActive) restBtn.disabled = true;
        else if (turnState.firstChoiceMade && turnState.actions[0] !== '休息') {
             restBtn.disabled = true;
        }
        if (turnState.actions.length === 1 && turnState.actions[0] === '休息') restBtn.classList.add('selected');
    } else {
        if (finalPlayerActions) {
            if (finalPlayerActions === '休息') restBtn.classList.add('selected'); else restBtn.disabled = true;
        }
    }
    actionButtonsArea.appendChild(restBtn);

    if (isTwoCardChooser && turnState.secondChoiceUiActive && !isFinalizing) {
        const skipBtn = document.createElement('button');
        skipBtn.dataset.choice = 'SKIP_SECOND_CHOICE';
        skipBtn.textContent = '完成選擇 (不選第二張)';
        skipBtn.onclick = () => selectAction(playerId, 'SKIP_SECOND_CHOICE', skipBtn);
        actionButtonsArea.appendChild(skipBtn);
    }
}

function marketStep() {
    console.info("===== 行動選擇階段開始 =====");
    players.forEach(p_id => {
        playerActions[p_id] = null;
        playerTurnChoices[p_id] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false };
        renderPlayerActionButtons(p_id);

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
    const turnState = playerTurnChoices[player];
    const choiceCardName = (typeof choice === 'number' || typeof choice === 'string' && choice !== '休息' && choice !== 'SKIP_SECOND_CHOICE') ? (cardData[choice]?.name || `卡片ID ${choice}`) : choice;


    if (isTwoCardChooser) {
        if (!turnState.firstChoiceMade) {
            if (turnState.actions.includes(choice)) { // 取消第一次選擇
                turnState.actions = [];
                console.info(`行動選擇: 玩家 [${player}] (技能6) - 取消第一次選擇 [${choiceCardName}]`);
            } else { // 進行第一次選擇
                turnState.actions = [choice];
                turnState.firstChoiceMade = true;
                if (choice === '休息') {
                    playerActions[player] = ['休息'];
                    turnState.secondChoiceUiActive = false;
                    console.info(`行動選擇: 玩家 [${player}] (技能6) - 第一次選擇 [休息]，行動結束`);
                    renderPlayerActionButtons(player, true); // 最終化顯示
                    checkAllActions();
                    return;
                } else { // 第一次選擇是卡片
                    turnState.secondChoiceUiActive = true;
                    console.info(`行動選擇: 玩家 [${player}] (技能6) - 第一次選擇卡片 [${choiceCardName}]，進入第二次選擇`);
                }
            }
        } else if (turnState.secondChoiceUiActive) { // 正在進行第二次選擇
            if (choice === turnState.actions[0]) { // 點擊已選的第一張卡 -> 取消第一次選擇
                const firstChoiceName = cardData[turnState.actions[0]]?.name || `卡片ID ${turnState.actions[0]}`;
                turnState.actions = [];
                turnState.firstChoiceMade = false;
                turnState.secondChoiceUiActive = false;
                playerActions[player] = null;
                console.info(`行動選擇: 玩家 [${player}] (技能6) - 從第二次選擇返回，取消第一次選擇 [${firstChoiceName}]`);
            } else if (choice === 'SKIP_SECOND_CHOICE') {
                playerActions[player] = [turnState.actions[0]];
                turnState.secondChoiceUiActive = false;
                const firstChoiceName = cardData[turnState.actions[0]]?.name || `卡片ID ${turnState.actions[0]}`;
                console.info(`行動選擇: 玩家 [${player}] (技能6) - 確認選擇 [${firstChoiceName}] 並跳過第二次`);
                renderPlayerActionButtons(player, true);
                checkAllActions();
                return;
            } else if (turnState.actions.length === 2 && turnState.actions[1] === choice) { // 取消已選的第二張卡
                turnState.actions.pop();
                playerActions[player] = null; // 清空最終行動，因為尚未完成兩次選擇
                console.info(`行動選擇: 玩家 [${player}] (技能6) - 取消第二次選擇 [${choiceCardName}]`);
            } else { // 選擇了第二張不同的卡 (或更改第二張卡的選擇)
                if (turnState.actions.length === 1) {
                    if (choice === turnState.actions[0]) { // 防禦
                         alert(`選擇提示: 第二張卡片不能與第一張選擇相同。`); return;
                    }
                    turnState.actions.push(choice);
                    console.info(`行動選擇: 玩家 [${player}] (技能6) - 第二次選擇卡片 [${choiceCardName}]`);
                 } else if (turnState.actions.length === 2) {
                    if (choice === turnState.actions[0]) { // 防禦
                         alert(`選擇提示: 第二張卡片不能與第一張選擇相同。`); return;
                    }
                    const oldSecondChoiceName = cardData[turnState.actions[1]]?.name || `卡片ID ${turnState.actions[1]}`;
                    console.info(`行動選擇: 玩家 [${player}] (技能6) - 更改第二次選擇從 [${oldSecondChoiceName}] 為 [${choiceCardName}]`);
                    turnState.actions[1] = choice;
                 }
                playerActions[player] = [...turnState.actions];
                turnState.secondChoiceUiActive = false;
                const finalChoicesNames = playerActions[player].map(c => cardData[c]?.name || c);
                console.info(`行動選擇: 玩家 [${player}] (技能6) - 確認兩次選擇: [${finalChoicesNames.join(' 和 ')}]`);
                renderPlayerActionButtons(player, true);
                checkAllActions();
                return;
            }
        }
        renderPlayerActionButtons(player); // 每次點擊後都重繪按鈕以反映選擇狀態
        checkAllActions();
    } else { // 標準玩家
        if (playerActions[player] === choice) { // 取消選擇
            playerActions[player] = null;
            console.info(`行動選擇: 玩家 [${player}] 取消選擇 [${choice === '休息' ? '休息' : (cardData[choice]?.name || choice) }]`);
        } else { // 選擇新的
            playerActions[player] = choice;
            console.info(`行動選擇: 玩家 [${player}] 確認選擇 [${choice === '休息' ? '休息' : (cardData[choice]?.name || choice) }]`);
        }
        renderPlayerActionButtons(player);
        checkAllActions();
    }
}

function checkAllActions() {
    const allPlayersActed = players.every(p_id => playerActions[p_id] !== null && playerActions[p_id] !== undefined);
    document.getElementById('nextRoundBtn').disabled = !allPlayersActed;
    if (allPlayersActed) {
        console.info("行動選擇階段: 所有玩家已完成行動選擇。可以進入下一回合。");
    }
}

function refreshPlayerActionButtons(playerId) {
    console.info(`行動刷新: 玩家 [${playerId}] 因時間調整，行動已重置。`);
    playerActions[playerId] = null;
    if (playerCharacterSkills[playerId] && playerCharacterSkills[playerId].type === "TWO_CARD_CHOICES") {
        playerTurnChoices[playerId] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false };
    }
    renderPlayerActionButtons(playerId);
    checkAllActions();
}

function adjustPlayerTimeManually(playerId, amount) {
    if (!players.includes(playerId) || !playerTimes.hasOwnProperty(playerId)) {
        console.warn(`手動調時: 警告 - 無效玩家ID [${playerId}] 或無時間資料。`); return;
    }
    const timeBeforeAdjust = playerTimes[playerId];
    let newTime = playerTimes[playerId] + amount;
    newTime = Math.max(0, Math.min(newTime, MAX_TIME));
    const actualChange = newTime - timeBeforeAdjust;
    const charName = characterSettings[playerCharacterSelections[playerId]]?.name || '';


    if (actualChange !== 0) {
        playerTimes[playerId] = newTime;
        const detailMsg = `手動調整: ${actualChange > 0 ? '+' : ''}${actualChange}時 (新時間 ${newTime})`;
        timeline[playerId].push({
            type: 'manual_adjust', subtype: actualChange > 0 ? 'plus' : 'minus',
            detail: detailMsg, timeChange: actualChange, timeAfter: playerTimes[playerId], round: round
        });
        updateTimeBar(playerId);
        console.info(`手動調時: 操作 - 玩家 [${playerId}] (${charName}) 時間 ${actualChange > 0 ? '+' : ''}${actualChange} -> ${newTime}`);
        refreshPlayerActionButtons(playerId);
    } else {
        console.info(`手動調時: 操作 - 玩家 [${playerId}] (${charName}) 時間無變化 (已達 ${amount > 0 ? '上限' : '下限'} ${playerTimes[playerId]})`);
    }
}

// ========= 核心遊戲邏輯: 回合進程 =========
async function nextRound() {
    console.info(`====== 回合 ${round} 行動結算開始 ======`);
    // console.debug(`回合 ${round} 玩家行動詳情: ${JSON.stringify(playerActions)}`);

    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    players.forEach(p => {
        const manualControls = document.getElementById('manualControls' + p);
        if (manualControls) manualControls.style.display = 'none';
        // 行動確認後，將玩家按鈕設定為最終化顯示
        renderPlayerActionButtons(p, true);
    });

    for (const p of players) { // 預檢查玩家行動資料的有效性
        const playerActionData = playerActions[p];
        const actionsToCheck = Array.isArray(playerActionData) ? playerActionData : [playerActionData];
        for (const action of actionsToCheck) {
            if (action && action !== '休息' && !cardData[action]) {
                console.error(`回合處理錯誤: 玩家 [${p}] 選擇的行動卡片ID [${action}] 無對應資料！`);
                alert(`嚴重錯誤: 玩家 [${p}] 的選擇包含無效卡片ID [${action}]。\n遊戲可能無法正常繼續，請檢查卡片設定或回溯。`);
                document.getElementById('nextRoundBtn').disabled = true; // 避免再次觸發
                return; // 中斷回合處理
            }
        }
    }

    gameStateBeforeNextRound = { // 保存用於競標取消時回溯的狀態
        playerTimes: JSON.parse(JSON.stringify(playerTimes)),
        timeline: JSON.parse(JSON.stringify(timeline)),
        round: round,
        availableCards: JSON.parse(JSON.stringify(availableCards)),
        marketCards: JSON.parse(JSON.stringify(marketCards)) // 保存本回合市場卡，抽牌時排除
    };

    const choiceCount = {}; // 統計每張卡片被多少玩家選擇
    players.forEach(p => {
        const playerActionData = playerActions[p];
        const actionsToProcess = Array.isArray(playerActionData) ? playerActionData : [playerActionData];
        actionsToProcess.forEach(action => {
            if (action === '休息') {
                const timeBeforeRest = playerTimes[p];
                let recoveryAmount = BASE_REST_RECOVERY_AMOUNT;
                const skillInfo = playerCharacterSkills[p];
                const charName = characterSettings[playerCharacterSelections[p]]?.name || '';
                
                const isSkillRest = skillInfo && skillInfo.type === "ENHANCED_REST" && skillInfo.value !== recoveryAmount;
                const skillNameForRest = isSkillRest ? charName : ''; // 使用角色名
                if (isSkillRest) {
                    recoveryAmount = skillInfo.value;
                }
                
                playerTimes[p] = Math.min(playerTimes[p] + recoveryAmount, MAX_TIME);
                const actualRecovery = playerTimes[p] - timeBeforeRest;
                
                const mainStatusText = isSkillRest ? "技能休息" : "休息回復";

                if (actualRecovery >= 0) {
                    const detailMsg = `${mainStatusText}: +${actualRecovery}時${isSkillRest ? ` (${skillNameForRest}技)` : ''} (新時間 ${playerTimes[p]})`;
                    timeline[p].push({
                        type: 'rest', subtype: 'recover', detail: detailMsg,
                        timeChange: actualRecovery, timeAfter: playerTimes[p], round: round
                    });
                    const consoleLogActionText = isSkillRest ? `技能休息 (${skillNameForRest})` : `休息`;
                    console.info(`玩家行動: [${p}] (${charName}) 執行 ${consoleLogActionText} - 時間 +${actualRecovery} -> ${playerTimes[p]}`);
                }
            } else if (action) { // action is a cardId
                choiceCount[action] = (choiceCount[action] || []).concat(p);
            }
        });
    });

    let biddingWasCancelledByUserAction = false;
    const chosenCardIds = Object.keys(choiceCount).map(id => parseInt(id));
    // 按照市場卡片的原順序處理 (gameStateBeforeNextRound.marketCards 保存了本回合市場順序)
    chosenCardIds.sort((a, b) => {
        const indexA = gameStateBeforeNextRound.marketCards.indexOf(a);
        const indexB = gameStateBeforeNextRound.marketCards.indexOf(b);
        if (indexA === -1 && indexB === -1) return 0; // 兩者都不在市場上 (理論上不應發生)
        if (indexA === -1) return 1; // a不在，b在，則b優先
        if (indexB === -1) return -1; // b不在，a在，則a優先
        return indexA - indexB; // 都在市場上，按原順序
    });

    for (const cardId of chosenCardIds) {
        const bidders = choiceCount[cardId];
        const currentCardInfo = cardData[cardId];
        const cardNameForLog = currentCardInfo?.name || `ID ${cardId}`;

        if (!currentCardInfo) { 
            console.error(`回合處理錯誤: 卡片ID [${cardId}] 在處理選擇時無對應資料。跳過此卡。`); 
            continue; 
        }

        if (bidders.length === 1) { // 直接購買
            const p = bidders[0];
            const charName = characterSettings[playerCharacterSelections[p]]?.name || '';
            const originalPrice = currentCardInfo.price;
            const actualCost = getAdjustedCardCost(p, originalPrice, 'direct_buy');
            const skillActive = actualCost < originalPrice;
            const detailMsg = `直接購買: ${cardNameForLog} (原${originalPrice}, 實${actualCost}${skillActive ? ' [技]' : ''})`;

            if (playerTimes[p] >= actualCost) {
                playerTimes[p] -= actualCost;
                timeline[p].push({
                    type: 'buy', subtype: 'direct', detail: detailMsg,
                    timeChange: -actualCost, timeAfter: playerTimes[p], round: round
                });
                console.info(`玩家行動: [${p}] (${charName}) 直接購買 [${cardNameForLog}] (原${originalPrice}, 實${actualCost}${skillActive ? ' [技]' : ''}), 剩餘時間 ${playerTimes[p]}`);
                const indexInAvailable = availableCards.indexOf(cardId);
                if (indexInAvailable > -1) {
                    availableCards.splice(indexInAvailable, 1);
                    console.info(`卡牌庫存: [${cardNameForLog}] (ID: ${cardId}) 已被購買移除。`);
                }
            } else {
                const failDetail = `購買失敗: ${cardNameForLog} (需 ${actualCost}, 現有 ${playerTimes[p]})`;
                timeline[p].push({
                    type: 'buy_fail', subtype: 'insufficient_funds_direct', detail: failDetail,
                    timeChange: 0, timeAfter: playerTimes[p], round: round
                });
                console.warn(`玩家行動: [${p}] (${charName}) 嘗試購買 [${cardNameForLog}] 失敗 (需 ${actualCost}, 現有 ${playerTimes[p]})`);
            }
        } else if (bidders.length > 1) { // 進入競標
            console.info(`競標流程: 卡片 [${cardNameForLog}] 進入競標 (參與玩家: [${bidders.join(', ')}])`);
            const biddingResultOutcome = await performBiddingProcess(cardId, bidders);

            if (biddingResultOutcome.userCancelled) {
                biddingWasCancelledByUserAction = true; break; // 中斷後續卡片處理
            }
            if (biddingResultOutcome.winner) { // 競標成功有人得標
                const indexInAvailable = availableCards.indexOf(cardId);
                if (indexInAvailable > -1) {
                    availableCards.splice(indexInAvailable, 1);
                    const winnerCharName = characterSettings[playerCharacterSelections[biddingResultOutcome.winner]]?.name || '';
                    console.info(`卡牌庫存: [${cardNameForLog}] (ID: ${cardId}) 已被玩家 [${biddingResultOutcome.winner}] (${winnerCharName}) 競標獲得並移除。`);
                }
            }
            // 抽牌 (如果需要)
            if (biddingResultOutcome.needsConsolationDraw && biddingResultOutcome.tiedPlayersForConsolation.length > 0) {
                await startConsolationDrawPhase(biddingResultOutcome.tiedPlayersForConsolation);
            }
        }
    } // 結束 for (const cardId of chosenCardIds)

    if (biddingWasCancelledByUserAction) {
        console.warn(`回合流程: 中止 - 因競標被使用者取消 (狀態應已回溯至行動選擇前)。`);
        // cancelBidding(true) 應該已經處理了UI回溯到marketStep
        return;
    }

    // 清理本回合市場上未被購買/競標的卡 (這些卡已在本回合出現過，不應再出現)
    const initialMarketCardsThisRound = gameStateBeforeNextRound.marketCards;
    if (initialMarketCardsThisRound && initialMarketCardsThisRound.length > 0) {
        console.info(`回合清理: 準備清理本回合未售市場卡 [${initialMarketCardsThisRound.map(id => cardData[id]?.name || `ID ${id}`).join(', ')}]`);
        initialMarketCardsThisRound.forEach(cardIdToRemove => {
            // 檢查這張卡是否還在 availableCards (可能已被購買或競標成功)
            const cardWasSoldOrWon = !availableCards.includes(cardIdToRemove);
            if (!cardWasSoldOrWon) { // 如果還在，表示未售出，則移除
                 const indexInAvailable = availableCards.indexOf(cardIdToRemove); // 再次確認 (理論上它應該還在)
                 if (indexInAvailable > -1) {
                    availableCards.splice(indexInAvailable, 1);
                    console.info(`市場棄牌: [${cardData[cardIdToRemove]?.name || `ID ${cardIdToRemove}`}] (未售出，從可用牌庫移除)`);
                 }
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
        console.info(`回合事件: 觸發 [${skillOwnerName}] 的回合結束技能 - 全體時間 +${timeBonusValue}`);

        players.forEach(p_id_to_receive_bonus => {
            const timeBeforeBonus = playerTimes[p_id_to_receive_bonus];
            playerTimes[p_id_to_receive_bonus] = Math.min(playerTimes[p_id_to_receive_bonus] + timeBonusValue, MAX_TIME);
            const actualTimeGained = playerTimes[p_id_to_receive_bonus] - timeBeforeBonus;
            if (actualTimeGained > 0) {
                const detailMsg = `技能加時: ${skillOwnerName} (+${actualTimeGained}時, 新時間 ${playerTimes[p_id_to_receive_bonus]})`;
                timeline[p_id_to_receive_bonus].push({
                    type: 'skill_effect', subtype: 'round_time_bonus',
                    detail: detailMsg, timeChange: actualTimeGained,
                    timeAfter: playerTimes[p_id_to_receive_bonus], round: round
                });
                 console.info(`回合事件: 玩家 [${p_id_to_receive_bonus}] (${characterSettings[playerCharacterSelections[p_id_to_receive_bonus]].name}) 因此技能獲得 +${actualTimeGained}時`);
            }
        });
    }

    round++;
    document.getElementById('roundTitle').textContent = `第 ${round} 回合`;
    playerActions = {}; // 清空上一回合的行動
    players.forEach(p => { playerTurnChoices[p] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false }; }); // 重置技能6的狀態
    document.getElementById('nextRoundBtn').disabled = true; // 新回合開始，禁用下一回合按鈕
    updateAllTimeBars();
    renderTimeline();
    gameStateBeforeNextRound = null; // 清除上回合保存的狀態
    console.info(`====== 回合 ${round -1 } 結束，準備進入回合 ${round}。可用卡牌剩餘 ${availableCards.length} 張 ======`);

    // 檢查遊戲是否結束 (所有卡片用完且市場無法形成)
    const marketAreaContainer = document.getElementById('marketArea'); // 確保 drawMarket 後再檢查
    drawMarket(); // 準備新市場
    const marketAreaButtons = marketAreaContainer.getElementsByTagName('button'); // 檢查市場上是否有按鈕

    if (availableCards.length === 0 && determineMaxMarketSelectionCount() === 0) { // 雙重條件：無可用牌，且市場也無法形成
        alert(`遊戲結束: 所有卡片均已處理完畢！感謝遊玩。`);
        const marketSelectionDiv = document.getElementById('marketSelection');
        marketSelectionDiv.innerHTML = '<h2 style="text-align:center; color: blue;">遊戲結束 - 所有卡片已處理</h2>';
        marketSelectionDiv.style.display = 'block'; // 確保市場區顯示遊戲結束訊息
        document.getElementById('playerActions').style.display = 'none';
        document.getElementById('nextRoundBtn').disabled = true;
        document.getElementById('backToMarketSelectionBtn').style.display = 'none';
        console.info(`====== 遊戲結束: 所有卡片均已處理完畢 (回合 ${round-1} 結束後) ======`);
        return;
    }

    // 準備新一輪的市場選擇
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('playerActions').style.display = 'none'; // 隱藏玩家行動區
}

// ========= 競標相關函式 =========
async function performBiddingProcess(cardId, bidders) {
    return new Promise((resolve) => {
        currentBidding = {
            cardId: cardId, bidders: [...bidders], bids: [], step: 0, resolvePromise: resolve,
            needsConsolationDraw: false, tiedPlayersForConsolation: []
        };
        const cardNameForLog = cardData[cardId]?.name || `ID ${cardId}`;
        console.info(`競標流程: 為卡片 [${cardNameForLog}] 開始 (參與玩家: [${bidders.join(', ')}])`);
        promptNextBidder();
    });
}

function promptNextBidder() {
    const oldWindow = document.querySelector('.bidding-window');
    if (oldWindow) oldWindow.remove();

    if (currentBidding.step >= currentBidding.bidders.length) {
        resolveBidding();
        return;
    }

    const biddingWindow = document.createElement('div');
    biddingWindow.className = 'bidding-window';
    const player = currentBidding.bidders[currentBidding.step];
    const maxBid = playerTimes[player];
    const cardInfoForBid = cardData[currentBidding.cardId];
    const cardNameForLog = cardInfoForBid?.name || `ID ${currentBidding.cardId}`;


    if (!cardInfoForBid) {
        console.error(`競標出價錯誤: 嘗試為卡片ID [${currentBidding.cardId}] 生成出價介面時，無對應卡片資料。`);
        if (currentBidding.resolvePromise) {
            currentBidding.resolvePromise({ userCancelled: true, bidResolvedWithoutConsolation: false, winner: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] });
        }
        currentBidding = { cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };
        return;
    }
    const minBid = cardInfoForBid.price;
    const playerCharKey = playerCharacterSelections[player];
    const playerCharDisplayName = characterSettings[playerCharKey]?.name || '未知角色';

    console.info(`競標出價提示: 輪到玩家 [${player}] (${playerCharDisplayName}) 對 [${cardNameForLog}] 出價 (可用時間 ${maxBid}, 卡片底價 ${minBid})`);
    biddingWindow.innerHTML = `<h3>玩家 ${player} (${playerCharDisplayName}) 出價 (現有時間: ${maxBid})</h3>
                             <p>競標目標: ${cardNameForLog} (原價/最低出價: ${minBid})</p>`;

    if (maxBid >= minBid) {
        for (let bid = minBid; bid <= maxBid; bid++) {
            const bidBtn = document.createElement('button');
            bidBtn.textContent = `出價 ${bid}`;
            bidBtn.onclick = () => handleBid(player, bid);
            biddingWindow.appendChild(bidBtn);
        }
    } else {
        biddingWindow.innerHTML += `<p style="color:red;">提示: 您的可用時間 ${maxBid}，不足以對此卡片 (${cardNameForLog}) 進行最低出價 ${minBid}。</p>`;
    }

    const passBtn = document.createElement('button');
    passBtn.textContent = '放棄出價 (Pass)';
    passBtn.style.backgroundColor = '#e57373';
    passBtn.onclick = () => handleBid(player, 0);
    biddingWindow.appendChild(passBtn);

    if (currentBidding.step > 0) {
        const backBtn = document.createElement('button');
        backBtn.textContent = '← 返回上一位';
        backBtn.style.backgroundColor = '#ffb74d';
        backBtn.onclick = () => {
            currentBidding.step--;
            const playerWhoseBidToModify = currentBidding.bidders[currentBidding.step];
            const cardNameBeingBidOn = cardData[currentBidding.cardId]?.name || `ID ${currentBidding.cardId}`;

            let removedBidForCard = false;
            for(let i = currentBidding.bids.length -1; i >= 0; i--) {
                if(currentBidding.bids[i].player === playerWhoseBidToModify && currentBidding.bids[i].cardId === currentBidding.cardId) {
                    const charNameOfPlayer = characterSettings[playerCharacterSelections[playerWhoseBidToModify]]?.name || '';
                    console.info(`競標流程: 操作 - 玩家 [${playerWhoseBidToModify}] (${charNameOfPlayer}) 返回上一步，已移除其先前對 [${cardNameBeingBidOn}] 的出價 ${currentBidding.bids[i].bid}。`);
                    currentBidding.bids.splice(i, 1);
                    removedBidForCard = true;
                    break;
                }
            }
            if(!removedBidForCard) {
                console.warn(`競標流程: 警告 - 嘗試返回上一步時，未找到玩家 [${playerWhoseBidToModify}] 先前對 [${cardNameBeingBidOn}] 的出價記錄。`);
            }
            promptNextBidder();
        };
        biddingWindow.appendChild(backBtn);
    }

    const cancelBtnElement = document.createElement('button');
    cancelBtnElement.textContent = '✖ 取消整輪競標 (回溯)';
    cancelBtnElement.style.backgroundColor = '#90a4ae';
    cancelBtnElement.onclick = () => cancelBidding(true);
    biddingWindow.appendChild(cancelBtnElement);

    document.body.appendChild(biddingWindow);
    biddingWindow.focus();
}

function handleBid(player, bidAmount) {
    currentBidding.bids = currentBidding.bids.filter(b => !(b.player === player && b.cardId === currentBidding.cardId));
    currentBidding.bids.push({ player: player, bid: bidAmount, cardId: currentBidding.cardId });
    const cardNameForLog = cardData[currentBidding.cardId]?.name || `ID ${currentBidding.cardId}`;
    const charName = characterSettings[playerCharacterSelections[player]]?.name || '';
    console.info(`競標流程: 玩家 [${player}] (${charName}) 對卡片 [${cardNameForLog}] 操作 - ${bidAmount === 0 ? '放棄出價' : `出價 ${bidAmount}`}`);
    currentBidding.step++;
    promptNextBidder();
}

function resolveBidding() {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    const cardIdBeingBidOn = currentBidding.cardId;
    const cardInfo = cardData[cardIdBeingBidOn] || { name: `未知卡片ID ${cardIdBeingBidOn}`, price: 0 };
    const cardNameForLog = cardInfo.name;
    const relevantBidsForThisCard = currentBidding.bids.filter(b => b.cardId === cardIdBeingBidOn);
    const activeBidsForThisCard = relevantBidsForThisCard.filter(b => b.bid > 0);
    const currentRoundForEvent = gameStateBeforeNextRound ? gameStateBeforeNextRound.round : round;

    let biddingOutcome = {
        userCancelled: false, bidResolvedWithoutConsolation: false, winner: null,
        needsConsolationDraw: false, tiedPlayersForConsolation: []
    };

    if (activeBidsForThisCard.length === 0) {
        const detailMsg = `全員放棄: ${cardNameForLog} (原價 ${cardInfo.price})`;
        currentBidding.bidders.forEach(p_id => {
            const playerMadeABidForThisCard = relevantBidsForThisCard.some(b => b.player === p_id);
            if (playerMadeABidForThisCard) {
                 timeline[p_id].push({
                    type: 'bidding', subtype: 'pass_all', detail: detailMsg,
                    timeChange: 0, timeAfter: playerTimes[p_id], round: currentRoundForEvent
                });
            }
        });
        console.info(`競標結果: 卡片 [${cardNameForLog}] - 全員放棄`);
        biddingOutcome.bidResolvedWithoutConsolation = true;
    } else {
        let maxBidValue = 0;
        activeBidsForThisCard.forEach(b => { if (b.bid > maxBidValue) maxBidValue = b.bid; });
        const potentialWinnerIds = [...new Set(activeBidsForThisCard.filter(b => b.bid === maxBidValue).map(b => b.player))];

        if (potentialWinnerIds.length === 1) {
            const winner = potentialWinnerIds[0];
            const winnerCharName = characterSettings[playerCharacterSelections[winner]]?.name || '';
            const actualCost = getAdjustedCardCost(winner, maxBidValue, 'bid_win');
            const skillActive = actualCost < maxBidValue;
            const skillTextForWin = skillActive ? ' [技]' : '';
            const winDetailMsg = `競標成功: ${cardNameForLog} (出價 ${maxBidValue}, 實花 ${actualCost}${skillTextForWin})`;

            timeline[winner].push({
                type: 'phase_tick', subtype: 'bid_win_marker',
                detail: `競標註記: ${cardNameForLog} (等待結算)`,
                timeChange: 0, timeAfter: playerTimes[winner], round: currentRoundForEvent
            });
            playerTimes[winner] -= actualCost;
            timeline[winner].push({
                type: 'bidding', subtype: 'win', detail: winDetailMsg,
                timeChange: -actualCost, timeAfter: playerTimes[winner], round: currentRoundForEvent
            });
            console.info(`競標結果: 玩家 [${winner}] (${winnerCharName}) 成功標得 [${cardNameForLog}] (出價 ${maxBidValue}, 實花 ${actualCost}${skillTextForWin}), 剩餘時間 ${playerTimes[winner]}`);

            relevantBidsForThisCard.forEach(({ player: p, bid: bVal }) => {
                if (p !== winner) {
                    const loserDetail = bVal > 0 ? `競標失敗: ${cardNameForLog} (出價 ${bVal})` : `放棄競標: ${cardNameForLog} (未出價)`;
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
            console.info(`競標事件: 卡片 [${cardNameForLog}] 出現平手 (最高出價 ${maxBidValue}), 平手玩家: [${potentialWinnerIds.map(pid => `${pid} (${characterSettings[playerCharacterSelections[pid]]?.name || ''})`).join(', ')}]`);
            let skill4Winner = null;
            const playersWithSkill4InTie = potentialWinnerIds.filter(p_id =>
                playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "WIN_BID_TIE"
            );

            if (playersWithSkill4InTie.length === 1) {
                skill4Winner = playersWithSkill4InTie[0];
                const skillUserCharName = characterSettings[playerCharacterSelections[skill4Winner]]?.name || '';
                console.info(`競標事件: 玩家 [${skill4Winner}] (${skillUserCharName}) 因技能 "追逐夢想的人" 優先解決平手。`);
            } else if (playersWithSkill4InTie.length > 1) {
                 const skillUsersNames = playersWithSkill4InTie.map(pid => `${pid} (${characterSettings[playerCharacterSelections[pid]]?.name || ''})`).join('、');
                 console.warn(`競標警告: 多名平手玩家 [${skillUsersNames}] 擁有優先技能，技能無法獨佔解決卡片 [${cardNameForLog}] 的平局。將視為一般平手。`);
                 // 在此情況下，不應有 skill4Winner，邏輯會進入下一個 else
            }

            if (skill4Winner) {
                const winnerCharName = characterSettings[playerCharacterSelections[skill4Winner]]?.name || '';
                const actualCost = getAdjustedCardCost(skill4Winner, maxBidValue, 'bid_win');
                const skillActive = actualCost < maxBidValue; // 技能1的減費也可能在此生效
                const skillTextForWin = skillActive ? ' [技]' : ''; // 標記是否有任何技能導致減費
                const skillWinDetailMsg = `技能勝出: ${cardNameForLog} (出價 ${maxBidValue}, 實花 ${actualCost}${skillTextForWin})`;

                timeline[skill4Winner].push({
                    type: 'phase_tick', subtype: 'bid_win_marker',
                    detail: `競標註記: ${cardNameForLog} (技能待結算)`,
                    timeChange: 0, timeAfter: playerTimes[skill4Winner], round: currentRoundForEvent
                });
                playerTimes[skill4Winner] -= actualCost;
                timeline[skill4Winner].push({
                    type: 'bidding', subtype: 'win_skill', detail: skillWinDetailMsg,
                    timeChange: -actualCost, timeAfter: playerTimes[skill4Winner], round: currentRoundForEvent
                });
                console.info(`競標結果: 玩家 [${skill4Winner}] (${winnerCharName}) 技能勝出獲得 [${cardNameForLog}] (出價 ${maxBidValue}, 實花 ${actualCost}${skillTextForWin}), 剩餘時間 ${playerTimes[skill4Winner]}`);

                relevantBidsForThisCard.forEach(({ player: p, bid: bVal }) => {
                    if (p !== skill4Winner) {
                        const detailText = potentialWinnerIds.includes(p) ? `平手技敗: ${cardNameForLog} (出價 ${bVal})` :
                                         (bVal > 0 ? `競標失敗: ${cardNameForLog} (出價 ${bVal})` : `放棄競標: ${cardNameForLog} (未出價)`);
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
                const tieDetailMsg = `平局流標: ${cardNameForLog} (最高出價 ${maxBidValue})`;
                console.info(`競標事件: 卡片 [${cardNameForLog}] 平局流標 (最高出價 ${maxBidValue})，參與玩家 [${potentialWinnerIds.map(pid => `${pid} (${characterSettings[playerCharacterSelections[pid]]?.name || ''})`).join(', ')}]，進抽牌階段。`);
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
}

function cancelBidding(fullCancel = false) {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    const promiseToResolve = currentBidding.resolvePromise;
    const biddingOutcomeOnCancel = { userCancelled: true, bidResolvedWithoutConsolation: false, winner: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };
    const cardNameBeingCancelled = cardData[currentBidding.cardId]?.name || `ID ${currentBidding.cardId}`;

    if (fullCancel && gameStateBeforeNextRound) {
        console.warn(`競標流程: 取消 - 對卡片 [${cardNameBeingCancelled}] 的競標已完全取消，狀態回溯至行動選擇前。`);
        playerTimes = gameStateBeforeNextRound.playerTimes;
        timeline = gameStateBeforeNextRound.timeline;
        round = gameStateBeforeNextRound.round;
        availableCards = gameStateBeforeNextRound.availableCards;
        marketCards = gameStateBeforeNextRound.marketCards;

        playerActions = {};
        players.forEach(p => { playerTurnChoices[p] = { actions: [], firstChoiceMade: false, secondChoiceUiActive: false }; });

        document.getElementById('roundTitle').textContent = `第 ${round} 回合`;
        document.getElementById('nextRoundBtn').disabled = true;
        document.getElementById('marketSelection').style.display = 'none';
        document.getElementById('playerActions').style.display = 'block';
        document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block';
        marketStep(); // 重繪行動按鈕
        updateAllTimeBars();
        renderTimeline();
    } else if (fullCancel && !gameStateBeforeNextRound) {
        console.error(`競標取消錯誤: 請求完全回溯對 [${cardNameBeingCancelled}] 的競標，但 gameStateBeforeNextRound 未定義。可能發生在回合開始前或狀態已損壞。`);
    } else {
        console.info(`競標流程: 操作 - 對卡片 [${cardNameBeingCancelled}] 的出價窗口已關閉 (非完全回溯)。`);
    }

    if (promiseToResolve) {
        promiseToResolve(biddingOutcomeOnCancel);
    }
    currentBidding = { cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };
    if (fullCancel) gameStateBeforeNextRound = null;
}

// ========= 抽牌/購買階段 =========
async function startConsolationDrawPhase(tiedPlayersList) {
    console.info(`抽牌階段: 開始 (參與玩家: [${tiedPlayersList.map(pid=> `${pid} (${characterSettings[playerCharacterSelections[pid]]?.name || ''})`).join(', ')}])`);
    const sortedTiedPlayers = tiedPlayersList.sort((a, b) => PLAYER_ID_MAP.indexOf(a) - PLAYER_ID_MAP.indexOf(b));

    let consolationSelectableCards = availableCards.filter(
        cardId => !(gameStateBeforeNextRound.marketCards.includes(cardId)) // 排除本回合市場上出現過的卡
    );
    console.info(`抽牌階段: 初始可選卡牌 ${consolationSelectableCards.length} 張 (已排除本回合市場卡: [${gameStateBeforeNextRound.marketCards.map(id => cardData[id]?.name || id).join(', ')}])`);

    for (const player of sortedTiedPlayers) {
        const playerCharName = characterSettings[playerCharacterSelections[player]]?.name || '';
        if (consolationSelectableCards.length === 0) {
            console.warn(`抽牌階段: 輪到玩家 [${player}] (${playerCharName}) 時，已無卡可供選擇`);
            const noCardAvailableDetail = `抽牌選擇: 無卡可選`;
            timeline[player].push({
                type: 'phase_info', subtype: 'consolation_no_cards_available',
                detail: noCardAvailableDetail,
                timeChange: 0, timeAfter: playerTimes[player], round: round
            });
        } else {
            console.info(`抽牌階段: 輪到玩家 [${player}] (${playerCharName}) 選擇卡片 (可選 ${consolationSelectableCards.length} 張: [${consolationSelectableCards.map(id=>cardData[id]?.name || id).join(', ')}])`);
            const chosenCardId = await promptConsolationCardChoice(player, [...consolationSelectableCards]);

            if (!chosenCardId) {
                const skipDetail = `抽牌選擇: 放棄 (未選卡)`;
                console.info(`抽牌階段: 玩家 [${player}] (${playerCharName}) 放棄選擇卡片`);
                timeline[player].push({
                    type: 'draw_decline', subtype: 'consolation_choice_skip', detail: skipDetail,
                    timeChange: 0, timeAfter: playerTimes[player], round: round
                });
            } else {
                const tempCardNameForLog = cardData[chosenCardId]?.name || `ID ${chosenCardId}`;
                consolationSelectableCards = consolationSelectableCards.filter(id => id !== chosenCardId);
                const indexInGlobalAvailable = availableCards.indexOf(chosenCardId);
                if (indexInGlobalAvailable > -1) {
                    console.info(`卡牌庫存: 抽牌選卡 - [${tempCardNameForLog}] 已被玩家 [${player}] 選中考慮，將從主牌庫移除`);
                    availableCards.splice(indexInGlobalAvailable, 1);
                } else {
                    console.warn(`抽牌警告: 卡片 [${chosenCardId}] (${tempCardNameForLog}) 被選中，但未在主牌庫找到！`);
                }

                const chosenCardInfo = cardData[chosenCardId];
                if (!chosenCardInfo) {
                    console.error(`抽牌錯誤: 玩家 [${player}] (${playerCharName}) 選擇的卡片ID [${chosenCardId}] 無有效資料。卡片已消耗。`);
                    const errorDetail = `系統錯誤: 抽牌卡片 [${chosenCardId}] 資料遺失`;
                    timeline[player].push({
                         type: 'error_event', subtype: 'consolation_card_data_missing',
                         detail: errorDetail,
                         timeChange: 0, timeAfter: playerTimes[player], round: round
                     });
                     continue;
                }
                console.info(`抽牌階段: 玩家 [${player}] (${playerCharName}) 正在考慮購買卡片 [${chosenCardInfo.name}] (ID: ${chosenCardId})`);

                const originalPrice = chosenCardInfo.price;
                const actualCost = getAdjustedCardCost(player, originalPrice, 'consolation_draw');
                const wantsToBuy = await promptConsolationPurchase(player, chosenCardInfo, actualCost);

                if (wantsToBuy && playerTimes[player] >= actualCost) {
                    playerTimes[player] -= actualCost;
                    const skillActive = actualCost < originalPrice;
                    const skillTextForDisplay = skillActive ? ' [技]' : '';
                    const detailMsg = `抽牌獲得: ${chosenCardInfo.name} (原${originalPrice}, 實${actualCost}${skillTextForDisplay})`;
                    timeline[player].push({
                        type: 'draw_acquire', subtype: 'consolation_purchase', detail: detailMsg,
                        timeChange: -actualCost, timeAfter: playerTimes[player], round: round
                    });
                    console.info('抽牌階段: 玩家 [${player}] (${playerCharName}) 獲得 [${chosenCardInfo.name}] (原${originalPrice}, 實${actualCost}${skillTextForDisplay}), 剩餘時間 ${playerTimes[player]}');
                } else {
                    const reason = (wantsToBuy && playerTimes[player] < actualCost) ? '時間不足' : '放棄購買';
                    const detailMsg = `抽牌放棄: ${chosenCardInfo.name} (${reason})`;
                    timeline[player].push({
                        type: 'draw_decline', subtype: 'consolation_purchase_decline', detail: detailMsg,
                        timeChange: 0, timeAfter: playerTimes[player], round: round
                    });
                    console.info(`抽牌階段: 玩家 [${player}] (${playerCharName}) 放棄購買 [${chosenCardInfo.name}] (原因: ${reason})`);
                }
            }
        }
        updateTimeBar(player);
    }
    console.info(`抽牌階段: 結束。`);
}

async function promptConsolationCardChoice(player, cardsForChoice) {
    return new Promise(resolve => {
        const oldWindow = document.querySelector('.consolation-choice-window');
        if (oldWindow) oldWindow.remove();

        if (!cardsForChoice || cardsForChoice.length === 0) {
            console.info(`抽牌階段提示: 玩家 [${player}] 無卡可選 (可選池為空)。`);
            resolve(null);
            return;
        }

        const windowDiv = document.createElement('div');
        windowDiv.className = 'bidding-window consolation-choice-window'; // Ensure bidding-window styles apply
        
        const playerCharKey = playerCharacterSelections[player];
        const playerCharDisplayName = characterSettings[playerCharKey]?.name || '該玩家';
        
        windowDiv.innerHTML = `<h3>玩家 ${player} (${playerCharDisplayName}) -請從抽出牌卡中選擇</h3>
                             <p>請從下列剩餘卡片中選擇一張進行考慮:</p>`;
        const cardListDiv = document.createElement('div');
        cardListDiv.className = 'scrollable-card-list';
        //cardListDiv.style.cssText = 'max-height: 300px; overflow-y: auto; margin-bottom: 15px; border: 1px solid #ccc; padding: 10px; background: #f9f9f9;';

        cardsForChoice.forEach(cardId => {
            const cardInfo = cardData[cardId];
            if (!cardInfo) {console.error(`抽牌階段錯誤: 準備卡片選擇列表時，卡片ID [${cardId}] 無對應資料。`); return;}
            const btn = document.createElement('button');
            btn.textContent = `${cardInfo.name} (原價: ${cardInfo.price})`;
            //btn.style.cssText = 'display: block; margin: 8px auto; width: 90%; padding: 10px; border-radius: 4px; background-color: #e0e0e0; border: 1px solid #bdbdbd; cursor:pointer;';
            //btn.onmouseover = () => btn.style.backgroundColor = '#d0d0d0';
            //btn.onmouseout = () => btn.style.backgroundColor = '#e0e0e0';
            btn.onclick = () => { windowDiv.remove(); resolve(cardId); };
            cardListDiv.appendChild(btn);
        });
        windowDiv.appendChild(cardListDiv);

        const passButton = document.createElement('button');
        passButton.textContent = '放棄選擇任何卡片';
        //passButton.style.cssText = 'margin-top: 10px; padding: 10px 15px; background-color: #ffcdd2; border: 1px solid #ef9a9a; border-radius: 4px; cursor: pointer;';
        passButton.classList.add('btn-pass');
        passButton.onmouseover = () => passButton.style.backgroundColor = '#ffb2b7';
        passButton.onmouseout = () => passButton.style.backgroundColor = '#ffcdd2';

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
        const playerCharDisplayName = characterSettings[playerCharKey]?.name || '該玩家';

        let displayCardInfo = cardInfoToPurchase;
        // 確保 displayCardInfo 有效，否則從 cardData 再找一次 (防禦性)
        if (!cardData[displayCardInfo.id]) { // 假設 cardInfoToPurchase 至少有 id
            const foundCard = cardData[displayCardInfo.id];
            if (foundCard) displayCardInfo = foundCard;
            else { // 極端情況，cardData 中也找不到
                 console.error('抽牌購買錯誤: 卡片ID [${displayCardInfo.id}] (${displayCardInfo.name}) 在 cardData 中未找到！');
                 // 即使如此，也盡量顯示已知資訊
            }
        }
        
        windowDiv.innerHTML = `
            <h3>玩家 ${player} (${playerCharDisplayName}) - 確認購買</h3>
            <p style="font-weight:bold; font-size: 1.1em;">您選擇了: ${displayCardInfo.name} ${displayCardInfo.id ? `(ID: ${displayCardInfo.id})`: ''}</p>
            <p><em>效果: ${displayCardInfo.effect || '無特殊效果描述'}</em></p>
            <p>原價: ${displayCardInfo.price}, 您的花費: <strong style="color: #d32f2f;">${actualCost}</strong></p>
            <p>您目前時間: ${playerTimes[player]}</p>`;

        const buyButton = document.createElement('button');
        buyButton.textContent = `確認購買 (花費 ${actualCost})`;
        buyButton.style.backgroundColor = '#a5d6a7'; // Greenish
        if (playerTimes[player] < actualCost) {
            buyButton.disabled = true; buyButton.title = "時間不足";
            buyButton.style.backgroundColor = '#ef9a9a'; // Reddish if disabled
        }
        buyButton.onclick = () => { windowDiv.remove(); resolve(true); };

        const passButton = document.createElement('button');
        passButton.textContent = '放棄購買此卡';
        passButton.style.backgroundColor = '#ffcc80'; // Orangish
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
        console.warn(`UI更新警告: 更新時間條時，玩家 [${player}] 無時間資料。`);
        return;
    }
    const time = playerTimes[player];
    const barInner = document.getElementById('bar' + player);
    if (!barInner) {
        console.warn(`UI更新警告: 更新時間條時，找不到玩家 [${player}] 的 '#bar${player}' (bar-inner) 元素。`);
        return;
    }

    const percentage = Math.max(0, (time / MAX_TIME * 100));
    barInner.style.width = percentage + '%';
    barInner.textContent = time;

    barInner.classList.remove('empty', 'danger', 'warning', 'safe');
    if (time <= 0) {
        barInner.style.background = '';
        barInner.textContent = '耗盡';
        barInner.classList.add('empty');
    } else if (time <= MAX_TIME * (1 / 3)) {
        barInner.style.background = '';
        barInner.classList.add('danger');
    } else if (time <= MAX_TIME * (2 / 3)) {
        barInner.style.background = '';
        barInner.classList.add('warning');
    } else {
        barInner.style.background = '';
        barInner.classList.add('safe');
    }
}

function updateAllTimeBars() {
    players.forEach(p_id => updateTimeBar(p_id));
}

let topZIndex = 100;
function renderTimeline() {
    players.forEach(p_id => {
        const eventsDiv = document.getElementById('events' + p_id);
        if (!eventsDiv) {
            console.warn(`UI更新警告: 渲染時間軸時，找不到玩家 [${p_id}] 的 '#events${p_id}' 容器。`);
            return;
        }
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

            let symbol = '?';
            const type = String(event.type).toLowerCase();
            const subtype = String(event.subtype).toLowerCase();

            if (type === 'rest') symbol = '休';
            else if (type === 'buy') symbol = '購';
            else if (type === 'buy_fail') symbol = 'X';
            else if (type === 'bidding') {
                if (subtype === 'win' || subtype === 'win_skill') symbol = '標✓';
                else if (subtype === 'tie_unresolved') symbol = '平';
                else if (subtype === 'pass_all') symbol = '全棄';
                else if (subtype === 'pass') symbol = '過';
                else if (subtype === 'lose' || subtype === 'lose_tie_skill') symbol = '標X';
                else symbol = '競';
            } else if (type === 'phase_tick') {
                if (subtype === 'bid_win_marker') symbol = '★';
                else symbol = '●';
            } else if (type === 'phase_info') symbol = 'i';
            else if (type === 'skill_effect') symbol = '技';
            else if (type === 'draw_acquire') symbol = '抽✓';
            else if (type === 'draw_decline') symbol = '抽X';
            else if (type === 'manual_adjust') {
                symbol = subtype === 'plus' ? '➕' : '➖';
            } else if (type === 'error_event') {
                symbol = '⚠';
            }
            segment.textContent = symbol;

            const tip = document.createElement('div');
            tip.className = 'tooltip ' + (index % 2 === 0 ? 'tooltip-top' : 'tooltip-bottom');
            let detailStr = event.detail || "(無詳細內容)";
            let roundStr = (event.round !== undefined) ? `(R${event.round}) ` : "";
            let timeChangeDisplay = "";
            if (event.timeChange !== undefined && event.timeChange !== null && !isNaN(event.timeChange)) {
                if (event.timeChange !== 0) {
                    timeChangeDisplay = ` → ${event.timeChange > 0 ? '+' : ''}${event.timeChange}時`;
                }
            }
            const timeAfterStr = (event.timeAfter === undefined || event.timeAfter === null || isNaN(event.timeAfter)) ? '未知' : event.timeAfter;
            tip.innerText = `${roundStr}${detailStr}${timeChangeDisplay} (新時間 ${timeAfterStr})`;
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
    const formattedLogEntries = consoleHistory.map(entry => {
        const localTimestamp = new Date(entry.timestamp).toLocaleString('zh-TW', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
        const message = entry.args.join(' ');
        return `[${localTimestamp}] [${entry.method.toUpperCase()}] ${message}`;
    });
    const logContent = formattedLogEntries.join('\n');

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
                            font-family: 'Courier New', Courier, monospace; 
                            white-space: pre-wrap; 
                            padding: 20px; 
                            line-height: 1.6; 
                            background-color: #1e1e1e; 
                            color: #d4d4d4; 
                            font-size: 14px;
                            margin: 0;
                        }
                        .log-header {
                            background-color: #333; color: #fff; padding: 10px 20px;
                            font-size: 1.2em; position: sticky; top: 0; z-index: 10;
                            display: flex; justify-content: space-between; align-items: center;
                        }
                        .log-header h1 { margin: 0; font-size: 1.2em; }
                        .controls button {
                            padding: 8px 15px; background-color: #555; color: #fff;
                            border: none; border-radius: 4px; cursor: pointer;
                            font-size: 0.9em; margin-left: 10px;
                        }
                        .controls button:hover { background-color: #777; }
                        pre { margin-top: 0; }
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
            logWindow.document.close();
            logWindow.focus();
            console.info(`紀錄匯出: 操作 - 遊戲紀錄已成功在新視窗開啟。`);
        } catch (e) {
            console.error(`紀錄匯出: 錯誤 - 無法寫入新視窗內容。`, e);
            alert(`紀錄匯出錯誤: 無法在新視窗中顯示遊戲紀錄。\n可能是彈出視窗被瀏覽器阻擋，或發生其他未知錯誤。`);
            if(logWindow) logWindow.close();
        }
    } else {
        console.warn(`紀錄匯出: 警告 - 無法開啟新視窗。請檢查瀏覽器的彈出視窗設定。`);
        alert(`紀錄匯出提示: 無法開啟新的紀錄視窗。\n請檢查您的瀏覽器是否已允許本網站的彈出式視窗。`);
    }
}