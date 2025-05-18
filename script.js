// ========= 全域遊戲狀態變數 =========
let gameStateBeforeNextRound = null;
let currentBidding = {
    cardId: null,
    bidders: [],
    bids: [],
    step: 0,
    resolvePromise: null
};
let players = [];
const PLAYER_ID_MAP = ['A', 'B', 'C'];
let playerTimes = {};
let playerActions = {};
let marketCards = [];
let selectedMarket = [];
let timeline = {};
let zIndexCounter = 100;
let round = 1;
let selectedPlayerCount = 0;
let playerCharacterSelections = {};
let playerCharacterSkills = {};
let playerTurnChoices = {};

// ========= 常數與資料設定 =========
let cardData = null;
let characterSettings = null;
let characterNames = [];

const MAX_TIME = 12;
const REST_RECOVERY_AMOUNT = 6;

const TIME_UNIT_WIDTH = 30;
const MIN_EVENT_SEGMENT_WIDTH = TIME_UNIT_WIDTH; // 讓0時間變化的事件也佔據1個單位寬
const EVENT_SEGMENT_HEIGHT = '25px';
const actionButtonsMap = {}; // player -> array of buttons

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

        console.log("卡片資料已載入:", Object.keys(cardData).length, "張");
        console.log("角色資料已載入:", characterNames.length, "種");

        document.getElementById('player1').disabled = false;
        document.getElementById('player2').disabled = false;
        document.getElementById('player3').disabled = false;
        document.getElementById('startButton').disabled = true;

    } catch (error) {
        console.error("初始化遊戲資料失敗:", error);
        alert(`錯誤：無法載入遊戲設定檔 (${error.message})。\n請檢查 console 的詳細錯誤訊息，確認 JSON 檔案路徑及內容。\n遊戲無法開始。`);
    }
}
document.addEventListener('DOMContentLoaded', initializeAppData);

// ========= 設定階段函式 =========
function selectPlayerCountUI(count) {
    if (!characterSettings || characterNames.length === 0) {
        alert("角色資料仍在載入中或載入失敗，請稍候。");
        return;
    }
    const playerOptionsButtons = document.querySelectorAll('.player-options button');
    const clickedButton = document.getElementById(`player${count}`);

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
        document.getElementById('characterSelectionError').textContent = '';
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
        document.getElementById('startButton').disabled = true;
        document.getElementById('characterSelectionError').textContent = '';
        document.getElementById('confirmCharactersButton').classList.remove('selected');
    }
}

function displayCharacterSelection(playerCount) {
    const container = document.getElementById('characterSelectorsContainer');
    container.innerHTML = '';
    const uiWrapper = document.getElementById('characterSelectionUI');

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
            characterNames.forEach(charNameKey => {
                const option = document.createElement('option');
                option.value = charNameKey;
                option.textContent = `${characterSettings[charNameKey].name} (起始時間: ${characterSettings[charNameKey].startTime})`;
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
    const chosenCharacterNamesSet = new Set(); // 用來檢查重複選擇
    const errorMsgElement = document.getElementById('characterSelectionError');
    errorMsgElement.textContent = '';

    for (let i = 0; i < selectedPlayerCount; i++) {
        const playerID = PLAYER_ID_MAP[i];
        const selectElement = document.getElementById(`characterSelect${playerID}`);
        const selectedCharKey = selectElement.value;

        if (!selectedCharKey) {
            allPlayersHaveChosen = false;
            errorMsgElement.textContent = `玩家 ${playerID} 尚未選擇角色。`;
            break;
        }
        if (chosenCharacterNamesSet.has(selectedCharKey)) {
            allPlayersHaveChosen = false;
            errorMsgElement.textContent = `角色 "${characterSettings[selectedCharKey].name}" 已被重複選擇，請更換。`;
            break;
        }
        playerCharacterSelections[playerID] = selectedCharKey;
        chosenCharacterNamesSet.add(selectedCharKey);
    }

    if (allPlayersHaveChosen) {
        document.getElementById('startButton').disabled = false;
        errorMsgElement.textContent = '角色已確認！可以點擊「開始遊戲」。';
        errorMsgElement.style.color = 'green';
        document.getElementById('confirmCharactersButton').classList.add('selected');
    } else {
        document.getElementById('startButton').disabled = true;
        errorMsgElement.style.color = 'red';
    }
}

function startGame() {
    if (Object.keys(playerCharacterSelections).length !== selectedPlayerCount || selectedPlayerCount === 0) {
        alert("請先完成人數選擇和所有玩家的角色確認。");
        return;
    }
    players = PLAYER_ID_MAP.slice(0, selectedPlayerCount);

    PLAYER_ID_MAP.forEach(pid => {
        const playerElement = document.getElementById('player' + pid);
        const timelinePlayerElement = document.getElementById('timeline' + pid);
        const playerTitleElement = document.getElementById('playerTitle' + pid); // HTML中為 playerA > h3
        const timelineTitleElement = document.getElementById('timelinePlayerTitle' + pid); // HTML中為 timelineA > h3
        const manualControls = document.getElementById('manualControls' + pid);

        if (playerElement) playerElement.style.display = 'none';
        if (timelinePlayerElement) timelinePlayerElement.style.display = 'none';
        if (playerTitleElement) playerTitleElement.textContent = `${pid}玩家`; // 重設標題
        if (timelineTitleElement) timelineTitleElement.textContent = `${pid}玩家 時間軸`; // 重設標題
        if (manualControls) manualControls.innerHTML = ''; // 清空手動按鈕
    });

    players.forEach(p_id => {
        document.getElementById('player' + p_id).style.display = 'flex'; // .player is flex column
        document.getElementById('timeline' + p_id).style.display = 'block';

        const selectedCharNameKey = playerCharacterSelections[p_id];
        const character = characterSettings[selectedCharNameKey];
        const selectedCharKey = playerCharacterSelections[p_id];
        const characterInfo = characterSettings[selectedCharKey];
        playerCharacterSkills[p_id] = characterInfo.skill ? {
            ...characterInfo.skill
        } : {
            type: "NONE"
        };
        playerTimes[p_id] = character.startTime;
        document.querySelector(`#player${p_id} > h3`).textContent = `${p_id}玩家 (${character.name})`;
        document.querySelector(`#timeline${p_id} > h3`).textContent = `${p_id}玩家 (${character.name}) (${character.startTime}) 時間軸`;

        timeline[p_id] = [];
        updateTimeBar(p_id);
    });

    document.querySelector('.setup').style.display = 'none';
    document.querySelector('.game-area').style.display = 'block';
    document.getElementById('timeline').style.display = 'block';
    round = 1;
    document.getElementById('roundTitle').textContent = '第' + round + '回合';
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('playerActions').style.display = 'none';
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    drawMarket();
}

// ========= 市場階段函式 =========
function drawMarket() {
    const maxSelection = determineMaxMarketSelectionCount(); // 獲取正確的市場卡片數量
    document.getElementById('marketSelectionTitle').textContent = `選擇本回合的 ${maxSelection} 張市場卡片`;
    document.getElementById('marketSelectionTitle').textContent = `點擊下方卡片進行選擇 (請選出 ${maxSelection} 張作為本回合市場卡片)`;
    const marketArea = document.getElementById('marketArea');
    marketArea.innerHTML = '';
    selectedMarket = []; // 清空上一輪在市場上點選的卡片

    if (availableCards.length === 0) {
        marketArea.innerHTML = '<p>所有卡片已被使用完畢！</p>';
        document.getElementById('confirmMarket').disabled = true;
        return;
    }

    // 列出所有 availableCards 供選擇
    availableCards.forEach(cardId => {
        const btn = document.createElement('button');
        const cardInfo = cardData[cardId];
        if (!cardInfo) {
            console.error(`drawMarket: 找不到卡片ID ${cardId} 的資料！`);
            return;
        }
        btn.textContent = `${cardInfo.name} (需時: ${cardInfo.price})`;
        btn.style.background = '#4CAF50'; // 預設未選中
        btn.onclick = () => toggleMarketCard(cardId, btn);
        marketArea.appendChild(btn);
    });
    updateConfirmMarketButtonState(); // 根據可選數量決定按鈕初始狀態
}

function toggleMarketCard(cardId, btn) {
    const isSelected = selectedMarket.includes(cardId);
    if (isSelected) {
        selectedMarket = selectedMarket.filter(c => c !== cardId);
    } else {
        const maxSelection = determineMaxMarketSelectionCount();
        if (selectedMarket.length >= maxSelection) {
            alert(`最多只能選擇 ${maxSelection} 張市場卡片。`);
            return;
        }
        selectedMarket.push(cardId);
    }
    updateMarketButtonState(cardId, btn);
    updateConfirmMarketButtonState();
}

function updateMarketButtonState(cardId, btn) {
    if (selectedMarket.includes(cardId)) {
        btn.style.background = '#2196F3';
    } else {
        btn.style.background = '#4CAF50';
    }
}

function updateConfirmMarketButtonState() {
    const maxSelection = determineMaxMarketSelectionCount();
    if (availableCards.length === 0) {
        document.getElementById('confirmMarket').disabled = true;
    } else {
        document.getElementById('confirmMarket').disabled = selectedMarket.length !== maxSelection;
    }
}

function confirmMarket() {
    const maxSelection = determineMaxMarketSelectionCount();
    if (selectedMarket.length !== maxSelection) {
        alert(`請選擇 ${maxSelection} 張市場卡片！`);
        return;
    }
    marketCards = [...selectedMarket];

    document.getElementById('marketSelection').style.display = 'none';
    document.getElementById('playerActions').style.display = 'block';
    document.getElementById('nextRoundBtn').disabled = true;
    document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block';

    marketStep();
}

function marketStep() {
    playerTurnChoices = {}; // 重設選擇狀態
    players.forEach(p => {
        playerTurnChoices[p] = {
            count: 0,
            firstCardId: null,
            actions: []
        };
        updateActionButtonsForPlayer(p); // ⬅️ 核心邏輯統一處理於此

        // 生成手動時間調整按鈕
        const manualControlsContainer = document.getElementById('manualControls' + p);
        manualControlsContainer.innerHTML = '';

        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+1 時間';
        plusBtn.onclick = () => adjustPlayerTimeManually(p, 1);

        const minusBtn = document.createElement('button');
        minusBtn.textContent = '-1 時間';
        minusBtn.onclick = () => adjustPlayerTimeManually(p, -1);

        manualControlsContainer.appendChild(plusBtn);
        manualControlsContainer.appendChild(minusBtn);
        manualControlsContainer.style.display = 'flex';
    });

    checkAllActions();
}

function createActionButton(player, choice, displayIndex) {
    const btn = document.createElement('button');

    if (choice === '休息') {
        btn.textContent = '休息';
    } else {
        const cardInfo = cardData[choice];
        if (!cardInfo) {
            console.error(`createActionButton: 找不到卡片ID ${choice} 的資料！`);
            btn.textContent = `錯誤卡片${displayIndex}`;
            btn.disabled = true;
        } else {
            btn.textContent = `待標商品${displayIndex} (${cardInfo.name} - 需時: ${cardInfo.price})`;
        }
    }

    btn.onclick = () => selectAction(player, choice, btn);
    document.getElementById('actions' + player).appendChild(btn);

    // ⭐ 紀錄按鈕到該玩家的按鈕陣列
    if (!actionButtonsMap[player]) {
        actionButtonsMap[player] = [];
    }
    actionButtonsMap[player].push(btn);
}

// 「重設市場卡片選擇」按鈕的邏輯 (在市場選擇階段使用)
function resetMarketCardSelection() {
    selectedMarket = [];
    // drawMarket 會重新列出所有 availableCards 並重置其按鈕狀態
    drawMarket();
    // updateConfirmMarketButtonState() 會在 drawMarket 後被間接調用或 toggleMarketCard 中處理
}

// 「返回市場選擇」按鈕的邏輯 (在玩家行動選擇階段使用)
function backToMarketSelection() {
    console.log("backToMarketSelection() called");
    playerActions = {};
    players.forEach(p => {
        const actionsArea = document.getElementById('actions' + p);
        if (actionsArea) actionsArea.innerHTML = '';
        const manualControls = document.getElementById('manualControls' + p);
        if (manualControls) manualControls.style.display = 'none'; // 隱藏手動調整按鈕
    });
    marketCards = []; // 清空本回合已確定的市場卡片
    // selectedMarket 應在 drawMarket 開始時清空

    document.getElementById('playerActions').style.display = 'none';
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    document.getElementById('nextRoundBtn').disabled = true;
    drawMarket(); // 重新繪製市場，列出所有 availableCards
}

//調整市場卡片數量 (技能ID "8")
function determineMaxMarketSelectionCount() {
    let marketSize = selectedPlayerCount + 1; // 基本數量：玩家人數 + 1
    let skill8Active = players.some(p_id =>
        playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "EXTRA_MARKET_CARD"
    );
    if (skill8Active) {
        marketSize++;
    }
    return Math.min(marketSize, availableCards.length); // 不能超過剩餘卡牌總數

}

// ========= 玩家行動函式 =========
function selectAction(player, choice, clickedButton) {
    const skillInfo = playerCharacterSkills[player];
    const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";

    if (isTwoCardChooser) {
        handleTwoCardPlayerAction(player, choice, clickedButton);
    } else {
        handleSingleChoicePlayerAction(player, choice, clickedButton);
    }

    checkAllActions(); // 驗證是否所有人都完成選擇
}

function markPlayerSelectedActions(player, finalActionsArray) {
    const actionButtonsContainer = document.getElementById('actions' + player);
    console.log(`玩家 ${player} 最終選擇: ${finalActionsArray.join(', ')}`);
    const buttons = Array.from(actionButtonsContainer.getElementsByTagName('button'));
    buttons.forEach(btn => {
        if (finalActionsArray.includes(btn.dataset.choice)) {
            btn.classList.add('selected');
        }
    });
}

function disableAllActionButtonsForPlayer(player) {
    const actionButtonsContainer = document.getElementById('actions' + player);
    const buttons = Array.from(actionButtonsContainer.children);
    buttons.forEach(btn => btn.disabled = true);
}

function updateButtonsForSecondChoice(player, firstCardId) {
    const actionButtonsContainer = document.getElementById('actions' + player);
    actionButtonsContainer.innerHTML = ''; // 清空所有舊按鈕

    const firstChoiceText = document.createElement('p');
    firstChoiceText.textContent = `已選: ${cardData[firstCardId].name}`;
    actionButtonsContainer.appendChild(firstChoiceText);

    const playerButtons = [];

    // 建立剩餘卡片選擇
    marketCards.forEach((cardId, index) => {
        if (cardId === firstCardId) return;
        const cardInfo = cardData[cardId];
        if (!cardInfo) return;
        const btn = document.createElement('button');
        btn.textContent = `${index + 1} (${cardInfo.name} - 需時: ${cardInfo.price})`;
        btn.dataset.choice = cardId;
        btn.onclick = () => selectAction(player, cardId, btn);
        actionButtonsContainer.appendChild(btn);
        playerButtons.push(btn);
    });

    // 放棄第二次選擇
    const skipButton = document.createElement('button');
    skipButton.textContent = '完成選擇 (不選第二張)';
    skipButton.dataset.choice = 'SKIP_SECOND_CHOICE';
    skipButton.onclick = () => selectAction(player, 'SKIP_SECOND_CHOICE', skipButton);
    actionButtonsContainer.appendChild(skipButton);
    playerButtons.push(skipButton);
    // 更新暫存
    actionButtonsMap[player] = playerButtons;
}

function handleSingleChoicePlayerAction(player, choice, clickedButton) {
    const buttons = actionButtonsMap[player] || [];

    if (playerActions[player] === choice) {
        // 取消選擇
        playerActions[player] = null;
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.classList.remove('selected');
        });
    } else {
        // 選擇新行動
        playerActions[player] = choice;
        buttons.forEach(btn => {
            btn.disabled = (btn !== clickedButton);
            if (btn === clickedButton) btn.classList.add('selected');
            else btn.classList.remove('selected');
        });
    }
}

function handleTwoCardPlayerAction(player, choice, clickedButton) {
    const turnState = playerTurnChoices[player];
    if (!turnState) return; // 安全檢查

    if (turnState.count === 0) {
        // 第一次選擇
        turnState.actions.push(choice);

        if (choice === '休息') {
            playerActions[player] = ['休息'];
            turnState.count = 2;
            disableAllActionButtonsForPlayer(player);
            clickedButton.classList.add('selected');
        } else {
            turnState.count = 1;
            turnState.firstChoiceWasCard = true;

            updateButtonsForSecondChoice(player, choice); // 建立新的選擇 UI
        }

    } else if (turnState.count === 1 && turnState.firstChoiceWasCard) {
        // 第二次選擇
        if (choice === 'SKIP_SECOND_CHOICE') {
            playerActions[player] = [turnState.actions[0]];
        } else {
            turnState.actions.push(choice);
            playerActions[player] = [...turnState.actions];
        }

        turnState.count = 2;
        disableAllActionButtonsForPlayer(player);
        markPlayerSelectedActions(player, playerActions[player]);
    }
}

function updateActionButtonsForPlayer(p) {
    const actionButtonsArea = document.getElementById('actions' + p);
    actionButtonsArea.innerHTML = '';

    let canAffordAnyCardOnMarket = false;

    marketCards.forEach(cardId => {
        const card = cardData[cardId];
        if (card && playerTimes[p] >= card.price) {
            canAffordAnyCardOnMarket = true;
        }
    });

    if (marketCards.length === 0 || !canAffordAnyCardOnMarket) {
        createActionButton(p, '休息');
        return;
    }

    marketCards.forEach((cardId, index) => {
        const card = cardData[cardId];
        if (!card) {
            console.error(`找不到卡片ID ${cardId} 的資料！`);
            return;
        }

        if (playerTimes[p] >= card.price) {
            createActionButton(p, cardId, index + 1);
        } else {
            const btn = document.createElement('button');
            btn.textContent = `待標商品${index + 1} (${card.name} - 需時: ${card.price}, 時間不足)`;
            btn.disabled = true;
            actionButtonsArea.appendChild(btn);
        }
    });

    createActionButton(p, '休息');
}

function checkAllActions() {
    const allPlayersActed = players.every(p => {
        const skillInfo = playerCharacterSkills[p];
        const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";
        const turnState = playerTurnChoices[p];

        if (isTwoCardChooser) {
            // 完成的條件：turnState.count === 2
            // (因為選休息或放棄第二次選擇都會使 count === 2)
            return turnState && turnState.count === 2;
        } else {
            return playerActions[p] !== null && playerActions[p] !== undefined;
        }
    });
    document.getElementById('nextRoundBtn').disabled = !allPlayersActed;
}

// 新增函式：手動調整玩家時間
function adjustPlayerTimeManually(playerId, amount) {
    if (!players.includes(playerId) || !playerTimes.hasOwnProperty(playerId)) {
        console.warn(`adjustPlayerTimeManually: 無效的玩家ID ${playerId} 或時間資料未初始化`);
        return;
    }

    const timeBeforeAdjust = playerTimes[playerId];
    let newTime = playerTimes[playerId] + amount;
    newTime = Math.max(0, Math.min(newTime, MAX_TIME));

    const actualChange = newTime - timeBeforeAdjust;

    if (actualChange !== 0) {
        playerTimes[playerId] = newTime;
        timeline[playerId].push({
            type: 'manual_adjust',
            subtype: actualChange > 0 ? 'plus' : 'minus',
            detail: `手動${actualChange > 0 ? '加時' : '減時'}：${Math.abs(actualChange)}`,
            timeChange: actualChange,
            timeAfter: playerTimes[playerId],
            round: round
        });
        updateTimeBar(playerId);
        renderTimeline();
        console.log(`玩家 ${playerId} 手動調整時間： ${amount > 0 ? '+' : ''}${actualChange}。新時間: ${playerTimes[playerId]}`);
        marketStep();
    } else {
        console.log(`玩家 ${playerId} 手動調整時間無效 (已達時間上下限)`);
    }
}

// ========= 核心遊戲邏輯: 回合進程 & 競標 =========
async function nextRound() {
    console.log("nextRound() called. Round:", round, "Player Actions:", JSON.parse(JSON.stringify(playerActions)));

    // --- 0. 回合開始前的準備 ---
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    players.forEach(p => {
        const manualControls = document.getElementById('manualControls' + p);
        if (manualControls) manualControls.style.display = 'none';
    });

    // --- 1. 技能ID "10": 小熊啾啾 - 回合初全体加時間 ---
    let skill10Active = players.some(p_id =>
        playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "ROUND_START_TIME_BONUS_ALL"
    );
    if (skill10Active) {
        const timeBonusValue = playerCharacterSkills[players.find(p_id => playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "ROUND_START_TIME_BONUS_ALL")] ?.value || 1;
        players.forEach(p_id_to_receive_bonus => {
            const timeBeforeBonus = playerTimes[p_id_to_receive_bonus];
            playerTimes[p_id_to_receive_bonus] = Math.min(playerTimes[p_id_to_receive_bonus] + timeBonusValue, MAX_TIME);
            const actualTimeGained = playerTimes[p_id_to_receive_bonus] - timeBeforeBonus;
            if (actualTimeGained > 0) {
                timeline[p_id_to_receive_bonus].push({
                    type: 'skill_effect',
                    subtype: 'round_time_bonus',
                    detail: `回合開始，技能效果時間 +${actualTimeGained}`,
                    timeChange: actualTimeGained,
                    timeAfter: playerTimes[p_id_to_receive_bonus],
                    round: round
                });
            }
        });
        console.log(`Round ${round}: All players received +${timeBonusValue} time due to 小熊啾啾 skill.`);
    }

    // --- 2. 檢查玩家選擇的卡片ID是否有效 (針對非休息行動) ---
    // (此檢查針對 playerActions 中儲存的 cardId)
    for (const p of players) {
        const playerActionData = playerActions[p]; // 可能為 cardId, '休息', 或 [cardId1, cardId2]
        const actionsToCheck = Array.isArray(playerActionData) ? playerActionData : [playerActionData];
        for (const action of actionsToCheck) {
            if (action && action !== '休息' && !cardData[action]) {
                console.error(`嚴重錯誤：玩家 ${p} 選擇的卡片ID ${action} 在 cardData 中找不到！`);
                alert(`錯誤：找不到卡片 ${action} 的資料！遊戲可能無法繼續。`);
                document.getElementById('nextRoundBtn').disabled = true;
                return; // 中止 nextRound
            }
        }
    }

    // --- 3. 儲存當前回合狀態 (用於可能的競標取消回溯) ---
    gameStateBeforeNextRound = {
        playerTimes: JSON.parse(JSON.stringify(playerTimes)),
        timeline: JSON.parse(JSON.stringify(timeline)),
        round: round,
        availableCards: JSON.parse(JSON.stringify(availableCards)),
        marketCards: JSON.parse(JSON.stringify(marketCards)) // 本回合市場上初始有哪些牌
    };

    // --- 4. 處理玩家行動：休息 和 收集卡片選擇 ---
    const choiceCount = {}; // { cardId: [playerA, playerB], ... }
    players.forEach(p => {
        const playerActionData = playerActions[p]; // cardId, '休息', or [cardId1, cardId2]
        const actionsToProcess = Array.isArray(playerActionData) ? playerActionData : [playerActionData];

        actionsToProcess.forEach(action => {
            if (action === '休息') {
                const timeBeforeRest = playerTimes[p];
                let recoveryAmount = REST_RECOVERY_AMOUNT;
                const skillInfo = playerCharacterSkills[p];
                if (skillInfo && skillInfo.type === "ENHANCED_REST") {
                    recoveryAmount = skillInfo.value;
                }
                playerTimes[p] = Math.min(playerTimes[p] + recoveryAmount, MAX_TIME);
                const actualRecovery = playerTimes[p] - timeBeforeRest;
                if (actualRecovery >= 0) { // 確保有恢復才記錄，或至少記錄嘗試休息
                    timeline[p].push({
                        type: 'rest',
                        subtype: 'recover',
                        detail: `恢復時間：+${actualRecovery}${(recoveryAmount !== REST_RECOVERY_AMOUNT && skillInfo) ? ` (${skillInfo.description})` : ''}`,
                        timeChange: actualRecovery,
                        timeAfter: playerTimes[p],
                        round: round
                    });
                }
            } else if (action) { // action is a cardId
                choiceCount[action] = (choiceCount[action] || []).concat(p);
            }
        });
    });

    // --- 5. 處理卡片選擇：直接購買 或 進入競標 ---
    let biddingWasCancelledByUserAction = false;
    const chosenCardIds = Object.keys(choiceCount).map(id => parseInt(id));
    // 建議對 chosenCardIds 進行排序，例如按照它們在 marketCards 中的順序，以確保競標的順序性
    chosenCardIds.sort((a, b) => {
        const indexA = gameStateBeforeNextRound.marketCards.indexOf(a);
        const indexB = gameStateBeforeNextRound.marketCards.indexOf(b);
        if (indexA === -1 && indexB === -1) return 0;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
    });

    for (const cardId of chosenCardIds) {
        const bidders = choiceCount[cardId]; // 想要這張卡的所有玩家
        const currentCardInfo = cardData[cardId];

        if (!currentCardInfo) {
            console.error(`nextRound: 處理卡片選擇時，ID ${cardId} 的資料在 cardData 中找不到，跳過。`);
            continue;
        }

        if (bidders.length === 1) {
            // ------ 5.1 直接購買 ------
            const p = bidders[0];
            const actualCost = getAdjustedCardCost(p, currentCardInfo.price, 'direct_buy');

            if (playerTimes[p] >= actualCost) {
                playerTimes[p] -= actualCost;
                timeline[p].push({
                    type: 'buy',
                    subtype: 'direct',
                    detail: `購買成功: ${currentCardInfo.name} (原價 ${currentCardInfo.price}, 實花 ${actualCost}${actualCost < currentCardInfo.price ? ' [技能減免]' : ''})`,
                    timeChange: -actualCost,
                    timeAfter: playerTimes[p],
                    round: round
                });
                // 從可用牌庫中移除已購買的卡片
                const indexInAvailable = availableCards.indexOf(cardId);
                if (indexInAvailable > -1) {
                    availableCards.splice(indexInAvailable, 1);
                    console.log(`卡片 ${cardId} (${currentCardInfo.name}) 已被 ${p} 直接購買，從可用卡片池移除。`);
                }
            } else {
                timeline[p].push({
                    type: 'buy_fail',
                    subtype: 'insufficient_funds_direct',
                    detail: `購買失敗: ${currentCardInfo.name} (需 ${actualCost}, 餘 ${playerTimes[p]})`,
                    timeChange: 0,
                    timeAfter: playerTimes[p],
                    round: round
                });
            }
        } else if (bidders.length > 1) {
            // ------ 5.2 進入競標 ------
            console.log(`卡片 ${cardId} (${currentCardInfo.name}) 進入競標。參與者: ${bidders.join(', ')}`);
            const biddingResultOutcome = await performBiddingProcess(cardId, bidders);

            if (biddingResultOutcome.userCancelled) {
                biddingWasCancelledByUserAction = true; // 由 cancelBidding() 函式處理狀態回溯
                console.log(`卡片 ${cardId} (${currentCardInfo.name}) 的競標被用戶操作取消。`);
                break; // 跳出 for (const cardId of chosenCardIds) 迴圈
            }

            if (biddingResultOutcome.winner) {
                // 卡片在競標中被贏得 (resolveBidding 已處理 timeline 和 playerTimes)
                const indexInAvailable = availableCards.indexOf(cardId);
                if (indexInAvailable > -1) {
                    availableCards.splice(indexInAvailable, 1);
                    console.log(`卡片 ${cardId} (${currentCardInfo.name}) 已被 ${biddingResultOutcome.winner} 競標贏得，從可用卡片池移除。`);
                }
            }
            // resolveBidding 內部已處理大部分 timeline 事件

            if (biddingResultOutcome.needsConsolationDraw && biddingResultOutcome.tiedPlayersForConsolation.length > 0) {
                await startConsolationDrawPhase(biddingResultOutcome.tiedPlayersForConsolation);
                // startConsolationDrawPhase 內部會處理卡片的購買、時間扣除、timeline 及 availableCards 的移除
            }
        }
    } // 結束 for (const cardId of chosenCardIds)

    // --- 6. 處理競標取消 ---
    if (biddingWasCancelledByUserAction) {
        console.log("nextRound 因競標取消而中止。狀態應已由 cancelBidding() 回溯。");
        // cancelBidding 應已重設UI，這裡直接返回
        return;
    }

    // --- 7. 回合結束清理：棄置本回合市場上未被購買的卡片 ---
    // gameStateBeforeNextRound.marketCards 是本回合初始放在市場上的卡片
    // 任何在 gameStateBeforeNextRound.marketCards 中，但現在仍然存在於 availableCards 的卡片，都應被棄置
    // 注意：直接購買、競標成功、安慰性抽牌獲得的卡片都已從 availableCards 移除
    const initialMarketCards = gameStateBeforeNextRound.marketCards;
    if (initialMarketCards && initialMarketCards.length > 0) {
        console.log(`回合 ${round} 結束，檢查市場棄牌: ${initialMarketCards.join(', ')}`);
        initialMarketCards.forEach(cardIdToRemove => {
            const indexInAvailable = availableCards.indexOf(cardIdToRemove);
            if (indexInAvailable > -1) { // 如果這張市場卡還在 availableCards (表示未通過任何方式被獲取)
                availableCards.splice(indexInAvailable, 1);
                const cardInfo = cardData[cardIdToRemove] || {
                    name: `ID ${cardIdToRemove}`
                };
                console.log(`市場卡 ${cardIdToRemove} (${cardInfo.name}) 未售出，已從可用卡片池中移除 (棄置)。`);
            }
        });
        console.log(`棄置操作後，可用卡片剩餘: ${availableCards.length}`);
    }
    // --- 8. 更新回合數及UI ---
    round++;
    document.getElementById('roundTitle').textContent = '第' + round + '回合';
    playerActions = {}; // 清空上一回合的玩家行動記錄
    if (typeof playerTurnChoices !== 'undefined') { // 如果使用了 playerTurnChoices (為技能6)
        players.forEach(p => {
            playerTurnChoices[p] = {
                count: 0,
                actions: [],
                firstChoiceWasCard: false
            };
        });
    }
    document.getElementById('nextRoundBtn').disabled = true;

    updateAllTimeBars();
    renderTimeline();
    gameStateBeforeNextRound = null; // 清理儲存的狀態
    console.log("nextRound completed. Advancing to round:", round);

    // --- 9. 檢查遊戲結束條件 ---
    // 如果可用卡片為0，並且 drawMarket() 之後市場區沒有可選按鈕 (表示牌抽完了也擺不上市場了)
    const marketAreaContainer = document.getElementById('marketArea'); // 先存起來
    drawMarket(); // 先畫出市場，才能檢查按鈕
    const marketAreaButtons = marketAreaContainer.getElementsByTagName('button');

    if (availableCards.length === 0 && marketAreaButtons.length === 0) {
        alert("所有卡片均已處理完畢，遊戲結束！");
        document.getElementById('marketSelection').innerHTML = '<h2>遊戲結束 - 所有卡片已處理</h2>';
        document.getElementById('playerActions').style.display = 'none';
        document.getElementById('nextRoundBtn').disabled = true;
        // 可以考慮禁用所有遊戲相關按鈕
        return;
    }

    // --- 10. 準備下一回合的市場選擇 ---
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('playerActions').style.display = 'none';
    selectedMarket = []; // 清空市場點選的卡片 (drawMarket內部也會清，但這裡重複確保)
    marketCards = []; // 清空上一回合確定的市場牌，因為 drawMarket 會重新產生
}

function getAdjustedCardCost(playerId, basePrice, purchaseContext) {
    let finalPrice = basePrice;
    const skillInfo = playerCharacterSkills[playerId];

    if (skillInfo) {
        if (skillInfo.type === "REDUCE_COST_GENERAL") {
            finalPrice -= skillInfo.value;
        } else if (skillInfo.type === "REDUCE_COST_CONSOLATION_DRAW" && purchaseContext === 'consolation_draw') {
            finalPrice -= skillInfo.value;
        }
    }
    return Math.max(0, finalPrice); // 確保價格不為負
}


async function startConsolationDrawPhase(tiedPlayersList) {
    console.log("開始安慰性抽牌/購買階段，參與者:", tiedPlayersList.join(', '));
    // 依照 A > B > C 順序 (假設 PLAYER_ID_MAP 已定義順序)
    const sortedTiedPlayers = tiedPlayersList.sort((a, b) => PLAYER_ID_MAP.indexOf(a) - PLAYER_ID_MAP.indexOf(b));

    for (const player of sortedTiedPlayers) {
        if (availableCards.length === 0) {
            console.log("市場已無卡牌可供安慰性選擇！");
            alert("市場已無卡牌，安慰性購買中止。");
            break; // 若無可用卡片，則中止此階段
        }

        console.log(`輪到玩家 ${player} 進行安慰性卡片選擇。`);
        // 玩家從可用的市場卡片中選擇一張
        const chosenCardId = await promptConsolationCardChoice(player, availableCards);

        if (!chosenCardId) {
            console.log(`玩家 ${player} 放棄選擇安慰卡或無卡可選。`);
            timeline[player].push({
                type: 'draw_decline', // 或者使用新的類型如 'consolation_skip'
                subtype: 'consolation_choice_skip',
                detail: `安慰性階段放棄選擇卡片`,
                timeChange: 0,
                timeAfter: playerTimes[player],
                round: round
            });
            renderTimeline(); // 更新時間軸顯示
            continue; // 輪到下一位玩家
        }

        const chosenCardInfo = cardData[chosenCardId];

        if (!chosenCardInfo) {
            console.error(`安慰性購買錯誤：找不到所選卡片ID ${chosenCardId} 的資料！`);
            // 此卡片ID來自 availableCards，理應存在。
            // 若不存在，表示有更深層的資料完整性問題。
            // 為安全起見，跳過此玩家本次的嘗試。
            continue;
        }
        console.log(`玩家 ${player} 在安慰性階段選擇了 ${chosenCardInfo.name} (ID: ${chosenCardId}) 進行考慮。`);

        const originalPrice = chosenCardInfo.price;
        // 'consolation_draw' 作為 purchaseContext，讓技能效果可以正確作用
        const actualCost = getAdjustedCardCost(player, originalPrice, 'consolation_draw');

        const wantsToBuy = await promptConsolationPurchase(player, chosenCardInfo, actualCost);

        if (wantsToBuy && playerTimes[player] >= actualCost) {
            playerTimes[player] -= actualCost;
            timeline[player].push({
                type: 'draw_acquire', // 或者 'market_acquire' 如果更適合你的事件分類
                subtype: 'consolation_purchase',
                detail: `安慰性階段購買 ${chosenCardInfo.name} (原價 ${originalPrice}, 花費 ${actualCost}${actualCost < originalPrice ? ' [技能減免]' : ''})`,
                timeChange: -actualCost,
                timeAfter: playerTimes[player],
                round: round
            });
            console.log(`玩家 ${player} 透過安慰性階段購買了 ${chosenCardInfo.name}。`);
            // 只有在成功購買後，才將卡片從 availableCards 中移除
            availableCards = availableCards.filter(id => id !== chosenCardId);
            // 如果此安慰階段會影響主市場的顯示，則重新繪製市場。
            // 目前假設在主市場設定階段之前不會影響，或主市場會重新繪製。
            // if (typeof drawMarket === 'function') drawMarket(); // 範例：若 availableCards 被 drawMarket 直接使用，可能需要重繪

        } else {
            const reason = (wantsToBuy && playerTimes[player] < actualCost) ? ' (時間不足)' : ' (選擇放棄購買)';
            timeline[player].push({
                type: 'draw_decline', // 或者 'market_decline'
                subtype: 'consolation_purchase_decline',
                detail: `安慰性階段放棄/無法購買所選的 ${chosenCardInfo.name}${reason}`,
                timeChange: 0,
                timeAfter: playerTimes[player],
                round: round
            });
            console.log(`玩家 ${player} 放棄/無法購買安慰性階段選擇的 ${chosenCardInfo.name}。卡片 ${chosenCardId} 返回市場。`);
            // 若未購買，卡片不會從 availableCards 中移除
        }
        updateTimeBar(player); // 即時更新該玩家的時間條
        renderTimeline();      // 即時更新時間軸
    }
    console.log("安慰性抽牌/購買階段結束。");
    updateAllTimeBars(); // 以防萬一，再次更新所有時間條
    // 如果市場區域仍然可見且需要反映 availableCards 的變化，可能需要重繪市場。
    // 這取決於你的遊戲流程 - 通常下一個階段會無論如何都重新繪製市場。
    // if (document.getElementById('marketArea').offsetParent !== null && typeof drawMarket === 'function') {
    //    console.log("安慰性階段結束後重新繪製市場。");
    //    drawMarket();
    // }
}
async function promptConsolationCardChoice(player, cardsForChoice) {
    return new Promise(resolve => {
        // 移除任何已存在的安慰性選擇視窗
        const oldWindow = document.querySelector('.consolation-choice-window');
        if (oldWindow) oldWindow.remove();

        if (cardsForChoice.length === 0) {
            alert(`玩家 ${player} 無卡可供選擇進行安慰性購買。`);
            resolve(null); // 沒有卡片可以選擇
            return;
        }

        const windowDiv = document.createElement('div');
        windowDiv.className = 'bidding-window consolation-choice-window'; // 可以重用競標視窗的樣式
        const playerCharNameKey = playerCharacterSelections[player];
        const playerCharName = playerCharNameKey ? characterSettings[playerCharNameKey].name : '';

        windowDiv.innerHTML = `
            <h3>玩家 ${player} ${playerCharName ? `(${playerCharName})` : ''} - 選擇安慰卡</h3>
            <p>請從下列市場卡片中選擇一張進行安慰性購買：</p>
        `;

        const cardListDiv = document.createElement('div');
        cardListDiv.style.maxHeight = '300px'; // 防止列表過長
        cardListDiv.style.overflowY = 'auto';  // 啟用垂直捲動
        cardListDiv.style.marginBottom = '15px';

        cardsForChoice.forEach(cardId => {
            const cardInfo = cardData[cardId];
            if (!cardInfo) {
                console.error(`promptConsolationCardChoice: 找不到卡片ID ${cardId} 的資料！`);
                return; // 如果找不到卡片資料，則跳過此卡片
            }
            const btn = document.createElement('button');
            btn.textContent = `${cardInfo.name} (原價: ${cardInfo.price})`;
            btn.style.display = 'block';    // 讓按鈕獨佔一行
            btn.style.margin = '5px auto'; // 設定按鈕邊距
            btn.onclick = () => {
                windowDiv.remove();
                resolve(cardId); // 回傳被選擇的卡片ID
            };
            cardListDiv.appendChild(btn);
        });

        windowDiv.appendChild(cardListDiv);

        // 新增一個放棄選擇的按鈕，如果玩家不想選擇任何安慰卡
        const passButton = document.createElement('button');
        passButton.textContent = '放棄選擇';
        passButton.style.marginTop = '10px';
        passButton.onclick = () => {
            windowDiv.remove();
            resolve(null); // 玩家選擇放棄
        };
        windowDiv.appendChild(passButton);

        document.body.appendChild(windowDiv);
        windowDiv.focus(); // 讓彈出視窗獲得焦點
    });
}

async function promptConsolationPurchase(player, cardInfo, actualCost) {

    return new Promise(resolve => {
        const oldWindow = document.querySelector('.consolation-purchase-window');
        if (oldWindow) oldWindow.remove();
        const windowDiv = document.createElement('div');
        windowDiv.className = 'bidding-window consolation-purchase-window';
        const playerCharNameKey = playerCharacterSelections[player];
        const playerCharName = playerCharNameKey ? characterSettings[playerCharNameKey].name : '';
        windowDiv.innerHTML = `
            <h3>玩家 ${player} ${playerCharName ? `(${playerCharName})` : ''} - 安慰性抽牌</h3>
            <p>您抽到了：<strong>${cardInfo.name}</strong> (ID: ${cardInfo.id || currentBidding.cardId})</p> <p>效果：${cardInfo.effect || '無特殊效果描述'}</p> <p>原價: ${cardInfo.price}, 您的花費: <strong>${actualCost}</strong></p>
            <p>您目前時間: ${playerTimes[player]}</p>`;

        const buyButton = document.createElement('button');
        buyButton.textContent = `購買 (花費 ${actualCost})`;
        if (playerTimes[player] < actualCost) {
            buyButton.disabled = true;
            buyButton.title = "時間不足";
        }
        buyButton.onclick = () => {
            windowDiv.remove();
            resolve(true);
        };
        const passButton = document.createElement('button');
        passButton.textContent = '放棄';
        passButton.onclick = () => {
            windowDiv.remove();
            resolve(false);
        };

        const buttonsContainer = document.createElement('div');
        buttonsContainer.style.marginTop = '15px';
        buttonsContainer.appendChild(buyButton);
        buttonsContainer.appendChild(passButton);
        windowDiv.appendChild(buttonsContainer);
        document.body.appendChild(windowDiv);
        windowDiv.focus(); // 讓彈窗獲得焦點
    });
}

async function performBiddingProcess(cardId, bidders) {
    return new Promise((resolve) => {
        currentBidding.cardId = cardId;
        currentBidding.bidders = bidders;
        currentBidding.bids = [];
        currentBidding.step = 0;
        currentBidding.resolvePromise = resolve;
        promptNextBidder();
    });
}

function promptNextBidder() {
    const oldWindow = document.querySelector('.bidding-window');
    if (oldWindow) oldWindow.remove();

    const biddingWindow = document.createElement('div');
    biddingWindow.className = 'bidding-window';

    const player = currentBidding.bidders[currentBidding.step];
    const maxBid = playerTimes[player];
    const cardInfoForBid = cardData[currentBidding.cardId]; // 使用 cardId
    if (!cardInfoForBid) {
        console.error(`promptNextBidder: 找不到卡片ID ${currentBidding.cardId} 的資料！`);
        if (currentBidding.resolvePromise) currentBidding.resolvePromise(true); // 以取消狀態結束
        return;
    }
    const minBid = cardInfoForBid.price;

    const playerCharNameKey = playerCharacterSelections[player];
    const playerCharInfo = characterSettings[playerCharNameKey];

    biddingWindow.innerHTML = `<h3>玩家 ${player} (${playerCharInfo.name}) 出價 (擁有時間: ${maxBid})</h3>`;
    biddingWindow.innerHTML += `<p>競標 ${cardInfoForBid.name} (原價/最低出價: ${minBid})</p>`;

    if (maxBid >= minBid) {
        for (let bid = minBid; bid <= maxBid; bid++) {
            const bidBtn = document.createElement('button');
            bidBtn.textContent = `出價 ${bid}`;
            bidBtn.onclick = () => handleBid(player, bid);
            biddingWindow.appendChild(bidBtn);
        }
    } else {
        biddingWindow.innerHTML += `<p>您的時間不足 ${minBid}，無法對此卡片進行最低出價。</p>`;
    }

    const passBtn = document.createElement('button');
    passBtn.textContent = '放棄出價';
    passBtn.onclick = () => handleBid(player, 0);
    biddingWindow.appendChild(passBtn);

    if (currentBidding.step > 0) {
        const backBtn = document.createElement('button');
        backBtn.textContent = '← 回到上一位出價者';
        backBtn.onclick = () => {
            currentBidding.step--;
            currentBidding.bids.pop();
            promptNextBidder();
        };
        biddingWindow.appendChild(backBtn);
    }

    const cancelBtnElement = document.createElement('button');
    cancelBtnElement.textContent = '✖ 取消整個競標 (回溯本回合行動)';
    cancelBtnElement.onclick = () => cancelBidding(true);
    biddingWindow.appendChild(cancelBtnElement);

    document.body.appendChild(biddingWindow);
}

function handleBid(player, bidAmount) {
    currentBidding.bids.push({
        player: player,
        bid: bidAmount
    });
    currentBidding.step++;

    if (currentBidding.step < currentBidding.bidders.length) {
        promptNextBidder();
    } else {
        resolveBidding();
    }
}

function resolveBidding() {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    const cardIdBeingBidOn = currentBidding.cardId;
    const cardInfo = cardData[cardIdBeingBidOn] || {
        name: `未知卡片ID ${cardIdBeingBidOn}`,
        price: 0
    };
    const activeBids = currentBidding.bids.filter(b => b.bid > 0);
    const currentRoundForEvent = gameStateBeforeNextRound ? gameStateBeforeNextRound.round : round;

    let biddingOutcome = { // 用於傳遞給 performBiddingProcess 的 Promise
        userCancelled: false,
        bidResolvedWithoutConsolation: false, // 標記競標是否有明確贏家 (無需安慰抽牌)
        winner: null,
        needsConsolationDraw: false,
        tiedPlayersForConsolation: []
    };

    if (activeBids.length === 0) {
        // ====== CASE 1: 所有參與者都放棄出價 ======
        currentBidding.bidders.forEach(p => {
            timeline[p].push({
                type: 'bidding',
                subtype: 'pass_all',
                detail: `全員放棄競標: ${cardInfo.name} (原價 ${cardInfo.price})`,
                timeChange: 0,
                timeAfter: playerTimes[p],
                round: currentRoundForEvent
            });
        });
        console.log(`卡片 ${cardIdBeingBidOn} (${cardInfo.name}) 因全員放棄而流標。`);
        biddingOutcome.bidResolvedWithoutConsolation = true; // 算是有結果 (結果是流標)
    } else {
        // ====== CASE 2: 有有效出價，找出最高出價者 ======
        let maxBidValue = 0;
        activeBids.forEach(b => {
            if (b.bid > maxBidValue) {
                maxBidValue = b.bid;
            }
        });

        const potentialWinners = activeBids.filter(b => b.bid === maxBidValue).map(b => b.player);

        if (potentialWinners.length === 1) {
            // ------ SUBCASE 2.1: 只有一位最高出價者 ------
            const winner = potentialWinners[0];
            const actualCost = getAdjustedCardCost(winner, maxBidValue, 'bid_win');

            playerTimes[winner] -= actualCost;
            timeline[winner].push({
                type: 'bidding',
                subtype: 'win',
                detail: `競標成功: ${cardInfo.name} (出價 ${maxBidValue}, 實際花費 ${actualCost}${actualCost < maxBidValue ? ' [技能減免]' : ''}, 原價 ${cardInfo.price})`,
                timeChange: -actualCost,
                timeAfter: playerTimes[winner],
                round: currentRoundForEvent
            });

            // 為其他出價者記錄失敗或放棄
            currentBidding.bids.forEach(({
                player: p,
                bid: b
            }) => {
                if (p !== winner) {
                    const detailText = b > 0 ? `競標 ${cardInfo.name} 失敗 (出價 ${b})` : `放棄競標 ${cardInfo.name}`;
                    const sub = b > 0 ? 'lose' : 'pass';
                    timeline[p].push({
                        type: 'bidding',
                        subtype: sub,
                        detail: detailText,
                        timeChange: 0,
                        timeAfter: playerTimes[p],
                        round: currentRoundForEvent
                    });
                }
            });
            console.log(`卡片 ${cardIdBeingBidOn} (${cardInfo.name}) 由 ${winner} 以 ${maxBidValue} (實際 ${actualCost}) 競標成功。`);
            biddingOutcome.bidResolvedWithoutConsolation = true;
            biddingOutcome.winner = winner;

        } else {
            // ------ SUBCASE 2.2: 多位最高出價者 (平手) ------
            console.log(`卡片 ${cardIdBeingBidOn} (${cardInfo.name}) 出現平手，最高出價 ${maxBidValue}，參與者: ${potentialWinners.join(', ')}`);
            let skill4Winner = null;
            const playersWithSkill4InTie = potentialWinners.filter(p_id =>
                playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "WIN_BID_TIE"
            );

            if (playersWithSkill4InTie.length === 1) {
                skill4Winner = playersWithSkill4InTie[0];
                console.log(`玩家 ${skill4Winner} (追逐夢想的人) 在平局中勝出！`);
            } else if (playersWithSkill4InTie.length > 1) {
                console.log(`多名玩家 (${playersWithSkill4InTie.join(', ')}) 擁有「追逐夢想的人」技能並在平局中，技能無法單獨決定勝者，視為普通平局。`);
                // 技能無法解決，將進入安慰性抽牌或流標
            } else {
                console.log(`平局中無玩家擁有「追逐夢想的人」技能或技能不適用。`);
                // 將進入安慰性抽牌或流標
            }

            if (skill4Winner) {
                const actualCost = getAdjustedCardCost(skill4Winner, maxBidValue, 'bid_win');
                playerTimes[skill4Winner] -= actualCost;
                timeline[skill4Winner].push({
                    type: 'bidding',
                    subtype: 'win_skill', // 與普通win區分
                    detail: `技能勝出: ${cardInfo.name} (出價 ${maxBidValue}, 實際花費 ${actualCost}${actualCost < maxBidValue ? ' [技能減免]' : ''}, 原價 ${cardInfo.price})`,
                    timeChange: -actualCost,
                    timeAfter: playerTimes[skill4Winner],
                    round: currentRoundForEvent
                });

                // 為其他平手者及出價者記錄
                currentBidding.bids.forEach(({
                    player: p,
                    bid: b
                }) => {
                    if (p !== skill4Winner) {
                        let detailText;
                        let sub_type;
                        if (potentialWinners.includes(p)) { // 其他一同平手的人
                            detailText = `競標 ${cardInfo.name} 平手後因技能落敗 (出價 ${b})`;
                            sub_type = 'lose_tie_skill';
                        } else if (b > 0) { // 其他出價較低的人
                            detailText = `競標 ${cardInfo.name} 失敗 (出價 ${b})`;
                            sub_type = 'lose';
                        } else { // 放棄的人
                            detailText = `放棄競標 ${cardInfo.name}`;
                            sub_type = 'pass';
                        }
                        timeline[p].push({
                            type: 'bidding',
                            subtype: sub_type,
                            detail: detailText,
                            timeChange: 0,
                            timeAfter: playerTimes[p],
                            round: currentRoundForEvent
                        });
                    }
                });
                biddingOutcome.bidResolvedWithoutConsolation = true;
                biddingOutcome.winner = skill4Winner;
            } else {
                // 平手且無技能解決 -> 卡片流標，觸發安慰性抽牌
                console.log(`卡片 ${cardIdBeingBidOn} (${cardInfo.name}) 競標平手且無技能解決，卡片流標，準備進入安慰性抽牌階段。`);
                potentialWinners.forEach(p_id => {
                    timeline[p_id].push({
                        type: 'bidding',
                        subtype: 'tie_unresolved',
                        detail: `${cardInfo.name} 競標平手流標 (出價 ${maxBidValue})，將進行安慰性抽牌`,
                        timeChange: 0,
                        timeAfter: playerTimes[p_id],
                        round: currentRoundForEvent
                    });
                });
                biddingOutcome.needsConsolationDraw = true;
                biddingOutcome.tiedPlayersForConsolation = [...potentialWinners];
                // 卡片本身在此次競標中未售出
            }
        }
    }

    if (currentBidding.resolvePromise) {
        currentBidding.resolvePromise(biddingOutcome);
    }
    currentBidding = {
        cardId: null,
        bidders: [],
        bids: [],
        step: 0,
        resolvePromise: null,
        needsConsolationDraw: false,
        tiedPlayersForConsolation: [] // 重設
    };
}

function cancelBidding(fullCancel = false) {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    let promiseToResolve = currentBidding.resolvePromise;

    if (fullCancel && gameStateBeforeNextRound) {
        playerTimes = gameStateBeforeNextRound.playerTimes;
        timeline = gameStateBeforeNextRound.timeline;
        round = gameStateBeforeNextRound.round;
        availableCards = gameStateBeforeNextRound.availableCards;
        marketCards = gameStateBeforeNextRound.marketCards;

        playerActions = {};

        document.getElementById('roundTitle').textContent = '第' + round + '回合';
        document.getElementById('nextRoundBtn').disabled = true;
        document.getElementById('marketSelection').style.display = 'none';
        document.getElementById('playerActions').style.display = 'block';
        document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block';

        marketStep();
        updateAllTimeBars();
        renderTimeline();

        if (promiseToResolve) {
            promiseToResolve(true);
        }
        currentBidding = {
            cardId: null,
            bidders: [],
            bids: [],
            step: 0,
            resolvePromise: null
        };
        gameStateBeforeNextRound = null;
        console.log("Bidding cancelled, state rolled back to action selection phase.");
        return;
    }

    if (promiseToResolve) {
        promiseToResolve(false);
    }
    currentBidding = {
        cardId: null,
        bidders: [],
        bids: [],
        step: 0,
        resolvePromise: null
    };
}

// ========= UI 更新函式 =========
function updateTimeBar(player) {
    const time = playerTimes[player];
    const barInner = document.getElementById('bar' + player);
    if (!barInner) {
        return;
    }
    barInner.style.width = Math.max(0, (time / MAX_TIME * 100)) + '%';
    if (time <= 0) {
        barInner.style.background = 'black';
        barInner.textContent = '時間耗盡';
    } else if (time > MAX_TIME * (2 / 3)) {
        barInner.style.background = 'green';
        barInner.textContent = time;
    } else if (time > MAX_TIME * (1 / 3)) {
        barInner.style.background = 'orange';
        barInner.textContent = time;
    } else {
        barInner.style.background = 'red';
        barInner.textContent = time;
    }
}

function updateAllTimeBars() {
    players.forEach(p => updateTimeBar(p));
}

function renderTimeline() {
    players.forEach(p => {
        const eventsDiv = document.getElementById('events' + p);
        if (!eventsDiv) {
            return;
        }
        eventsDiv.innerHTML = '';

        if (!timeline[p] || timeline[p].length === 0) {
            return;
        }

        timeline[p].forEach((e, index) => {
            const segment = document.createElement('div');
            segment.className = 'event';
            if (e.type) segment.classList.add(e.type);
            if (e.subtype) segment.classList.add(e.subtype);

            let calculatedWidthPx = MIN_EVENT_SEGMENT_WIDTH;
            const timeChangeNum = Number(e.timeChange);

            if (!isNaN(timeChangeNum) && timeChangeNum !== 0) {
                calculatedWidthPx = Math.abs(timeChangeNum) * TIME_UNIT_WIDTH;
            }
            // 確保即使 timeChangeNum 很小 (例如 0.1) 導致 calculatedWidthPx 小於 MIN_EVENT_SEGMENT_WIDTH，
            // 也至少使用 MIN_EVENT_SEGMENT_WIDTH。
            // 因為 MIN_EVENT_SEGMENT_WIDTH = TIME_UNIT_WIDTH，這也確保了 timeChangeNum 的絕對值為1的事件
            // 和 timeChangeNum 為0的事件視覺寬度相同。
            calculatedWidthPx = Math.max(calculatedWidthPx, MIN_EVENT_SEGMENT_WIDTH);

            segment.style.width = calculatedWidthPx + 'px';
            segment.style.height = EVENT_SEGMENT_HEIGHT;

            let symbol = '';
            if (e.type === 'rest') symbol = '休';
            else if (e.type === 'buy') symbol = '買';
            else if (e.type === 'buy_fail') symbol = 'X'; // 購買失敗符號
            else if (e.type === 'bidding') {
                if (e.subtype === 'win') symbol = '標✓';
                else if (e.subtype === 'tie_fail') symbol = '流';
                else if (e.subtype === 'pass_all') symbol = '全棄';
                else if (e.subtype === 'pass') symbol = '棄';
                else if (e.subtype === 'lose') symbol = '敗';
                else symbol = '競';
            } else if (e.type === 'phase_tick') {
                symbol = '●';
            } else if (e.type === 'manual_adjust') {
                symbol = e.subtype === 'plus' ? '➕' : '➖';
                // 文字顏色由 CSS .event.manual_adjust 控制
            }
            segment.textContent = symbol;

            const tip = document.createElement('div');
            tip.className = 'tooltip ' + (index % 2 === 0 ? 'tooltip-top' : 'tooltip-bottom');
            let detailStr = e.detail || "（無詳細資料）";
            let roundStr = (e.round !== undefined) ? `(R${e.round}) ` : "";
            let timeChangeStr = (e.timeChange !== undefined && e.timeChange !== null) ? `${e.timeChange > 0 ? '+' : ''}${e.timeChange}` : "N/A";
            let timeAfterStr = (e.timeAfter !== undefined && e.timeAfter !== null) ? e.timeAfter : "N/A";
            tip.innerText = `${roundStr}${detailStr} (時間變化: ${timeChangeStr}, 剩餘: ${timeAfterStr})`;
            segment.appendChild(tip);

            segment.onclick = () => {
                segment.classList.toggle('enlarged');
                segment.style.zIndex = zIndexCounter++;
            };

            eventsDiv.appendChild(segment);
        });
    });
}

const consoleHistory = [];

['log', 'info', 'warn', 'error'].forEach(method => {
    const original = console[method];
    console[method] = function (...args) {
        consoleHistory.push({
            method,
            args,
            timestamp: new Date().toISOString()
        });
        original.apply(console, args); // 照常顯示在開發者工具中
    };
});

function downloadConsoleLog() {
    const cleanedLines = consoleHistory.map(entry =>
        entry.args.join(' ')
    );

    // Step 1: 玩家人數
    const playerCount = selectedPlayerCount

    // Step 2: 組合檔名
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const filename = `${dateStr} 玩家人數${playerCount} 總共進行${round}回.TXT`;

    // Step 4: 建立下載連結
    const blob = new Blob([cleanedLines.join('\n')], {
        type: 'text/plain'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}