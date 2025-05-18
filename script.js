// =================================================================================
// Script.js - 故事卡競拍遊戲記錄
// =================================================================================

// ========= 全域遊戲狀態變數 =========
let gameStateBeforeNextRound = null; // 用於競標取消時回溯
let currentBidding = { // 當前競標狀態
    cardId: null,
    bidders: [],
    bids: [],
    step: 0,
    resolvePromise: null,
    // 以下兩個欄位由 resolveBidding 填充，並由 nextRound 檢查
    needsConsolationDraw: false,     // 標記競標結果是否需要安慰性抽牌
    tiedPlayersForConsolation: []  // 參與安慰性抽牌的玩家
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
const TIME_UNIT_WIDTH = 10; // 時間軸上每個時間單位代表的寬度 (px)
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

        characterNames = Object.keys(characterSettings); // 這些是角色設定檔中的 "1", "2", ...
        availableCards = Object.keys(cardData).map(id => parseInt(id)); // 假設卡片ID是數字

        console.log(`資料載入: ${Object.keys(cardData).length} 張卡片，${characterNames.length} 種角色`);

        document.getElementById('player1').disabled = false;
        document.getElementById('player2').disabled = false;
        document.getElementById('player3').disabled = false;
        document.getElementById('startButton').disabled = true;

    } catch (error) {
        console.error("初始化錯誤:", error);
        alert(`初始化錯誤：無法載入遊戲設定檔 (${error.message})。\n請檢查 console 的詳細錯誤訊息，並確認 JSON 檔案路徑及內容。\n遊戲無法開始。`);
    }
}
document.addEventListener('DOMContentLoaded', initializeAppData);

// ========= 輔助函式 =========
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function determineMaxMarketSelectionCount() {
    let marketSize = selectedPlayerCount + 1;
    let skill8Active = players.some(p_id =>
        playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "EXTRA_MARKET_CARD"
    );
    if (skill8Active) {
        marketSize++;
        console.log("市場調整: 技能「街頭故事李白」生效，市場卡片上限+1");
    }
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
            console.log(`成本調整: 玩家 ${playerId} 技能 [${skillInfo.description}] 生效，費用 -${skillInfo.value}`);
        }
        // 技能5: 堅定志向的人 (僅安慰性抽牌/購買時減費)
        // 這裡的邏輯是，如果技能1已通用減費，技能5的條件可能需要更精確判斷是否疊加或獨立。
        // 目前假設：如果角色有技能1，則其效果已包含安慰性抽牌。若角色只有技能5，則只在安慰性抽牌生效。
        // 若一個角色理論上可能同時擁有多個減費技能（雖然目前說角色唯一），則需定義疊加規則。
        // 鑑於角色唯一，一個玩家只會有一個主要技能。
        else if (skillInfo.type === "REDUCE_COST_CONSOLATION_DRAW" && purchaseContext === 'consolation_draw') {
            finalPrice -= skillInfo.value;
            console.log(`成本調整: 玩家 ${playerId} 技能 [${skillInfo.description}] 生效 (安慰性抽牌)，費用 -${skillInfo.value}`);
        }
    }
    return Math.max(0, finalPrice); // 確保價格不為負
}


// ========= 設定階段函式 =========
function selectPlayerCountUI(count) {
    if (!characterSettings || characterNames.length === 0) {
        alert("角色資料仍在載入中或載入失敗，請稍候。");
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
        document.getElementById('confirmCharactersButton').style.backgroundColor = ''; // 恢復預設綠色
        document.getElementById('startButton').disabled = true; // 需先確認角色才能開始
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
            errorMsgElement.textContent = `錯誤提示: 玩家 ${playerID} 尚未選擇角色。`;
            break;
        }
        if (chosenCharacterKeys.has(selectedCharKey)) {
            allPlayersHaveChosen = false;
            errorMsgElement.textContent = `錯誤提示: 角色 "${characterSettings[selectedCharKey].name}" 已被重複選擇，請更換。`;
            break;
        }
        playerCharacterSelections[playerID] = selectedCharKey; // 儲存key
        chosenCharacterKeys.add(selectedCharKey);
    }

    if (allPlayersHaveChosen) {
        document.getElementById('startButton').disabled = false;
        errorMsgElement.textContent = '角色確認: 所有玩家選擇完畢！可開始遊戲。';
        errorMsgElement.style.color = 'green';
        document.getElementById('confirmCharactersButton').style.backgroundColor = '#007bff'; // 選中後的藍色
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

    // 洗牌 (availableCards)
    shuffleArray(availableCards);
    console.log("遊戲開始: 可用卡牌已洗牌。");

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

// ========= 市場階段函式 =========
function drawMarket() {
    const marketArea = document.getElementById('marketArea');
    marketArea.innerHTML = '';
    selectedMarket = []; // 清空上一輪在市場UI上點選的卡片

    const maxSelection = determineMaxMarketSelectionCount();
    document.getElementById('marketSelectionTitle').textContent = `選擇本回合的 ${maxSelection} 張市場卡片`;
    document.getElementById('marketInfo').textContent = `點擊下方卡片進行選擇 (請選出 ${maxSelection} 張作為本回合市場卡片)`;


    if (availableCards.length === 0) {
        marketArea.innerHTML = '<p>市場提示: 所有卡片已被使用完畢！</p>';
        document.getElementById('confirmMarket').disabled = true;
        // 這裡可能也意味著遊戲結束，可以在 nextRound 中更全面地判斷
        return;
    }
    if (maxSelection === 0 && availableCards.length > 0) {
         marketArea.innerHTML = `<p>市場提示: 本回合無足夠卡片形成市場 (需要至少 ${selectedPlayerCount + 1} 張，當前剩餘 ${availableCards.length})。</p>`;
         document.getElementById('confirmMarket').disabled = true; // 若無法選出足夠卡片，也禁用確認
         // 這種情況可能也需要特殊處理，例如直接進入下一回合或結束遊戲
         return;
    }


    // 顯示所有 availableCards 供主持人選擇
    availableCards.forEach(cardId => {
        const cardInfo = cardData[cardId];
        if (!cardInfo) {
            console.error(`市場繪製錯誤: 找不到卡片ID ${cardId} 的資料！`);
            return;
        }
        const btn = document.createElement('button');
        btn.textContent = `${cardInfo.name} (需時: ${cardInfo.price})`;
        btn.dataset.cardId = cardId; // 儲存卡片ID，方便操作
        btn.style.background = '#4CAF50'; // 預設未選中樣式 (綠色)
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
        btn.classList.remove('selected'); // 使用CSS class控制選中樣式
        btn.style.background = '#4CAF50'; // 恢復預設
    } else {
        if (selectedMarket.length >= maxSelection) {
            alert(`市場選擇上限: 最多只能選擇 ${maxSelection} 張市場卡片。`);
            return;
        }
        selectedMarket.push(cardId);
        btn.classList.add('selected');
        btn.style.background = '#007bff'; // 選中樣式 (藍色)
    }
    updateConfirmMarketButtonState();
}

function updateConfirmMarketButtonState() {
    const maxSelection = determineMaxMarketSelectionCount();
    const confirmButton = document.getElementById('confirmMarket');
    if (availableCards.length === 0 || maxSelection === 0) { // 如果沒牌或無法形成市場
        confirmButton.disabled = true;
    } else {
        confirmButton.disabled = selectedMarket.length !== maxSelection;
    }
}

function resetMarketCardSelection() {
    console.log("市場操作: 重設選擇");
    selectedMarket = [];
    // drawMarket 會重新渲染按鈕並清除 .selected class (因為按鈕是新建的)
    // 它也會調用 updateConfirmMarketButtonState
    drawMarket();
}

function confirmMarket() {
    const maxSelection = determineMaxMarketSelectionCount();
    if (selectedMarket.length !== maxSelection) {
        alert(`市場確認錯誤: 請選擇剛好 ${maxSelection} 張市場卡片！`);
        return;
    }
    marketCards = [...selectedMarket]; // 將選中的卡片設為本回合的市場卡片
    console.log(`市場操作: 確認市場卡片 ${marketCards.join(', ')}`);

    document.getElementById('marketSelection').style.display = 'none';
    document.getElementById('playerActions').style.display = 'block';
    document.getElementById('nextRoundBtn').disabled = true; // 等待所有玩家行動
    document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block';

    // 為玩家行動階段做準備
    playerActions = {}; // 清空上一輪的行動
    players.forEach(p => { // 重置技能6的玩家選擇狀態
         playerTurnChoices[p] = { count: 0, actions: [], firstChoiceWasCard: false };
    });
    marketStep();
}

function backToMarketSelection() {
    console.log("返回操作: 返回選擇市場卡片");
    // 重設玩家行動相關狀態
    playerActions = {};
    players.forEach(p => {
        const actionsArea = document.getElementById('actions' + p);
        if (actionsArea) actionsArea.innerHTML = '';
        const manualControls = document.getElementById('manualControls' + p);
        if (manualControls) manualControls.style.display = 'none'; // 隱藏手動調整
        playerTurnChoices[p] = { count: 0, actions: [], firstChoiceWasCard: false }; // 重設技能6狀態
    });
    marketCards = []; // 清空已確認的市場卡片
    // selectedMarket 已經在 drawMarket 開始時清空

    document.getElementById('playerActions').style.display = 'none';
    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    document.getElementById('nextRoundBtn').disabled = true; // 返回後需重新確認市場和行動

    drawMarket(); // 重新繪製市場選擇界面
}

// ========= 玩家行動函式 =========
function marketStep() {
    console.log("行動階段: 開始");
    players.forEach(p_id => {
        const actionButtonsArea = document.getElementById('actions' + p_id);
        actionButtonsArea.innerHTML = ''; // 清空舊按鈕
        playerTurnChoices[p_id] = { count: 0, actions: [], firstChoiceWasCard: false }; // 初始化/重置技能6狀態

        let canAffordAnyCard = false;
        if (marketCards.length > 0) {
            marketCards.forEach(cardId => {
                const cardInfo = cardData[cardId];
                if (cardInfo && playerTimes[p_id] >= getAdjustedCardCost(p_id, cardInfo.price, 'direct_buy')) { // 預估直接購買成本
                    canAffordAnyCard = true;
                }
            });
        }

        const skillInfo = playerCharacterSkills[p_id];
        const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";

        if (isTwoCardChooser) {
            actionButtonsArea.dataset.player = p_id; // 標記父容器
            // 提示該玩家可以選兩張
            const skillHint = document.createElement('p');
            skillHint.textContent = `提示: ${characterSettings[playerCharacterSelections[p_id]].name} 本回合可選擇至多兩張不同故事卡。`;
            skillHint.style.fontSize = '0.9em';
            skillHint.style.color = '#555';
            actionButtonsArea.appendChild(skillHint);
        }


        if (marketCards.length === 0 || !canAffordAnyCard) {
            // 市場無卡或一張都買不起，只能休息
            createActionButton(p_id, '休息', 0);
        } else {
            marketCards.forEach((cardId, index) => {
                const cardInfo = cardData[cardId];
                if (!cardInfo) {
                    console.error(`行動階段錯誤: 找不到卡片ID ${cardId} 的資料！`);
                    return;
                }
                // 預估直接購買成本 (僅供顯示，實際購買時會再計算)
                const estimatedCost = getAdjustedCardCost(p_id, cardInfo.price, 'direct_buy');
                if (playerTimes[p_id] >= estimatedCost) {
                    createActionButton(p_id, cardId, index + 1);
                } else {
                    const btn = document.createElement('button');
                    btn.textContent = `待標商品${index + 1} (${cardInfo.name} - 需時: ${cardInfo.price}, 時間不足)`;
                    btn.disabled = true;
                    actionButtonsArea.appendChild(btn);
                }
            });
            createActionButton(p_id, '休息', 0); // 休息選項總是可用
        }

        // 生成手動時間調整按鈕
        const manualControlsContainer = document.getElementById('manualControls' + p_id);
        manualControlsContainer.innerHTML = ''; // 清空舊按鈕
        const plusBtn = document.createElement('button');
        plusBtn.textContent = '+1 時間';
        plusBtn.onclick = () => adjustPlayerTimeManually(p_id, 1);
        const minusBtn = document.createElement('button');
        minusBtn.textContent = '-1 時間';
        minusBtn.onclick = () => adjustPlayerTimeManually(p_id, -1);
        manualControlsContainer.appendChild(plusBtn);
        manualControlsContainer.appendChild(minusBtn);
        manualControlsContainer.style.display = 'flex';
    });
    checkAllActions(); // 檢查初始狀態是否允許進入下一回合 (不太可能)
}

function createActionButton(playerId, choice, displayIndexOrZeroForRest, isSecondChoiceContext = false) {
    const actionButtonsArea = document.getElementById('actions' + playerId);
    const btn = document.createElement('button');
    btn.dataset.choice = choice; // 儲存選擇值 (cardId 或 '休息')

    if (choice === '休息') {
        btn.textContent = '休息';
    } else { // choice is a cardId
        const cardInfo = cardData[choice];
        if (!cardInfo) {
            console.error(`創建按鈕錯誤: 找不到卡片ID ${choice} 的資料！`);
            btn.textContent = `錯誤卡片${displayIndexOrZeroForRest}`;
            btn.disabled = true;
        } else {
            // 顯示預估成本
            const estimatedCost = getAdjustedCardCost(playerId, cardInfo.price, 'direct_buy');
            let costDisplay = `需時: ${cardInfo.price}`;
            if (estimatedCost < cardInfo.price) {
                costDisplay += ` (技 ${estimatedCost})`;
            }
            btn.textContent = `待標商品${displayIndexOrZeroForRest} (${cardInfo.name} - ${costDisplay})`;
        }
    }
    btn.onclick = () => selectAction(playerId, choice, btn);
    actionButtonsArea.appendChild(btn);
}

// 技能6 ("藝術家性格的人") 第一次選卡後，更新按鈕狀態準備第二次選擇
function updateButtonsForSecondChoice(player, firstCardId) {
    const actionButtonsArea = document.getElementById('actions' + player);
    // 不直接清空，而是禁用和修改現有按鈕，並添加“跳過”按鈕
    const buttons = Array.from(actionButtonsArea.getElementsByTagName('button'));

    // 先將第一個選擇的按鈕標記為已選並禁用
    buttons.forEach(btn => {
        if (btn.dataset.choice === firstCardId) {
            btn.classList.add('selected');
            btn.disabled = true;
        } else if (btn.dataset.choice === '休息') { // 休息按鈕在第二次選擇時禁用
            btn.disabled = true;
            btn.classList.remove('selected');
        } else { // 其他卡片按鈕保持可選，除非是已選的或已禁用
            if (btn.dataset.choice) { // 確保是卡片按鈕
                 const cardInfo = cardData[btn.dataset.choice];
                 const estimatedCost = getAdjustedCardCost(player, cardInfo.price, 'direct_buy');
                 if (playerTimes[player] < estimatedCost && btn.dataset.choice !== 'SKIP_SECOND_CHOICE') { // SKIP按鈕不檢查費用
                     btn.disabled = true; // 如果第二次選不起，則禁用
                 } else {
                    btn.disabled = false;
                 }
            }
            btn.classList.remove('selected');
        }
    });

    // 檢查是否已有跳過按鈕，若無則添加
    let skipButton = actionButtonsArea.querySelector('button[data-choice="SKIP_SECOND_CHOICE"]');
    if (!skipButton) {
        skipButton = document.createElement('button');
        skipButton.textContent = '完成選擇 (不選第二張)';
        skipButton.dataset.choice = 'SKIP_SECOND_CHOICE';
        skipButton.onclick = () => selectAction(player, 'SKIP_SECOND_CHOICE', skipButton);
        actionButtonsArea.appendChild(skipButton);
    } else {
        skipButton.disabled = false; // 確保跳過按鈕可用
    }
}


function selectAction(player, choice, clickedButton) {
    const skillInfo = playerCharacterSkills[player];
    const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";
    const turnState = playerTurnChoices[player];
    const actionButtonsContainer = document.getElementById('actions' + player);
    const allButtonsInContainer = Array.from(actionButtonsContainer.getElementsByTagName('button'));

    console.log(`行動選擇: 玩家 ${player}, 選擇 ${choice}, 第 ${turnState.count + 1} 次`);

    if (isTwoCardChooser && turnState.count < 2) {
        if (turnState.count === 0) { // 第一次選擇
            turnState.actions.push(choice);
            turnState.count = 1;

            if (choice === '休息') {
                playerActions[player] = ['休息']; // 最終行動
                turnState.firstChoiceWasCard = false; // 非卡片
                turnState.count = 2; // 標記兩次選擇均完成 (因休息後無後續)
                allButtonsInContainer.forEach(btn => btn.disabled = true);
                clickedButton.classList.add('selected');
            } else { // 第一次選擇是卡片
                turnState.firstChoiceWasCard = true;
                // clickedButton 已被點擊，其狀態應由外部CSS或即時JS處理，這裡主要是禁用其他
                updateButtonsForSecondChoice(player, choice); // 更新UI準備第二次選擇
                document.getElementById('nextRoundBtn').disabled = true; // 因為還未完成所有必要選擇
                return; // 等待第二次選擇，不立即調用 checkAllActions
            }
        } else if (turnState.count === 1 && turnState.firstChoiceWasCard) { // 第二次選擇
            if (choice === 'SKIP_SECOND_CHOICE') {
                playerActions[player] = [turnState.actions[0]]; // 最終行動是第一次選的卡
                console.log(`行動選擇: 玩家 ${player} 跳過第二次選擇，確認行動: ${playerActions[player]}`);
            } else { // 選擇了第二張卡
                if (choice === turnState.actions[0]) { // 不能選同一張
                    alert("提示：不能選擇與第一次相同的卡片作為第二次選擇。");
                    return;
                }
                turnState.actions.push(choice);
                playerActions[player] = [...turnState.actions];
                console.log(`行動選擇: 玩家 ${player} 完成兩次選擇，確認行動: ${playerActions[player]}`);
            }
            turnState.count = 2; // 標記選擇完成
            allButtonsInContainer.forEach(btn => btn.disabled = true); // 禁用所有按鈕
            // 高亮最終選擇的按鈕
            playerActions[player].forEach(act => {
                const selectedBtn = allButtonsInContainer.find(btn => btn.dataset.choice === act);
                if (selectedBtn) selectedBtn.classList.add('selected');
            });
            if (choice === 'SKIP_SECOND_CHOICE') { // 如果是跳過，則跳過按鈕短暫高亮後也應處理
                 const skipBtn = allButtonsInContainer.find(btn => btn.dataset.choice === 'SKIP_SECOND_CHOICE');
                 if(skipBtn) skipBtn.classList.add('selected'); // 也可以不加
            }
        }
    } else if (!isTwoCardChooser) { // 普通玩家的邏輯
        if (playerActions[player] === choice) { // 取消選擇
            playerActions[player] = null;
            allButtonsInContainer.forEach(btn => {
                const cardInfo = cardData[btn.dataset.choice]; // 假設 '休息' 按鈕沒有 cardData
                let canAfford = true;
                if (cardInfo) { // 如果是卡片按鈕
                    const estimatedCost = getAdjustedCardCost(player, cardInfo.price, 'direct_buy');
                    canAfford = playerTimes[player] >= estimatedCost;
                }
                btn.disabled = !canAfford && btn.dataset.choice !== '休息' ; // 買不起的還是禁用
                btn.classList.remove('selected');
            });
        } else { // 確認選擇
            playerActions[player] = choice;
            allButtonsInContainer.forEach(btn => {
                btn.disabled = true; // 其他按鈕禁用
                if (btn === clickedButton) {
                    btn.classList.add('selected');
                } else {
                    btn.classList.remove('selected');
                }
            });
        }
    }

    checkAllActions();
}


function checkAllActions() {
    const allPlayersActed = players.every(p_id => {
        const skillInfo = playerCharacterSkills[p_id];
        const isTwoCardChooser = skillInfo && skillInfo.type === "TWO_CARD_CHOICES";
        const turnState = playerTurnChoices[p_id];

        if (isTwoCardChooser) {
            return turnState && turnState.count === 2; // 必須完成兩步決策
        } else {
            return playerActions[p_id] !== null && playerActions[p_id] !== undefined;
        }
    });
    document.getElementById('nextRoundBtn').disabled = !allPlayersActed;
    if (allPlayersActed) {
        console.log("狀態檢查: 所有玩家行動完畢，可進入下一回合。");
    }
}

function adjustPlayerTimeManually(playerId, amount) {
    if (!players.includes(playerId) || !playerTimes.hasOwnProperty(playerId)) {
        console.warn(`手動調時警告: 無效玩家ID ${playerId}`);
        return;
    }
    const timeBeforeAdjust = playerTimes[playerId];
    let newTime = playerTimes[playerId] + amount;
    newTime = Math.max(0, Math.min(newTime, MAX_TIME));
    const actualChange = newTime - timeBeforeAdjust;

    if (actualChange !== 0) {
        playerTimes[playerId] = newTime;
        const detailMsg = `手動調時: ${actualChange > 0 ? '+' : ''}${actualChange} 時間 (新時間 ${newTime})`;
        timeline[playerId].push({
            type: 'manual_adjust', subtype: actualChange > 0 ? 'plus' : 'minus',
            detail: detailMsg,
            timeChange: actualChange, timeAfter: playerTimes[playerId], round: round
        });
        updateTimeBar(playerId);
        renderTimeline();
        console.log(`手動調時: 玩家 ${playerId} ${detailMsg}`);
        // 手動調時後，可能影響玩家購買能力，重新評估其行動按鈕
        // (目前簡化：不自動重置其已選行動，但主持人應注意)
        // 如果需要，可以清除 playerActions[playerId] 並部分重繪其行動區
        // refreshPlayerActionButtons(playerId); // 假設有此函式
    } else {
        console.log(`手動調時: 玩家 ${playerId} 時間無變化 (已達上下限)`);
    }
}


// ========= 核心遊戲邏輯: 回合進程 =========
async function nextRound() {
    console.log(`回合開始: ${round} (玩家行動: ${JSON.stringify(playerActions)})`);

    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    players.forEach(p => {
        const manualControls = document.getElementById('manualControls' + p);
        if (manualControls) manualControls.style.display = 'none';
    });

    // 技能ID "10": 小熊啾啾 - 回合初全体加時間
    let skill10Active = players.some(p_id =>
        playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "ROUND_START_TIME_BONUS_ALL"
    );
    if (skill10Active) {
        // 假設技能數值存在 skill.value，若無則預設為1
        const skillHolder = players.find(p_id => playerCharacterSkills[p_id]?.type === "ROUND_START_TIME_BONUS_ALL");
        const timeBonusValue = playerCharacterSkills[skillHolder]?.value || 1;

        players.forEach(p_id_to_receive_bonus => {
            const timeBeforeBonus = playerTimes[p_id_to_receive_bonus];
            playerTimes[p_id_to_receive_bonus] = Math.min(playerTimes[p_id_to_receive_bonus] + timeBonusValue, MAX_TIME);
            const actualTimeGained = playerTimes[p_id_to_receive_bonus] - timeBeforeBonus;
            if (actualTimeGained > 0) {
                const detailMsg = `回合加時: +${actualTimeGained} 時間 (${characterSettings[playerCharacterSelections[skillHolder]].name}技)`; // 顯示技能來源角色
                timeline[p_id_to_receive_bonus].push({
                    type: 'skill_effect', subtype: 'round_time_bonus', detail: detailMsg,
                    timeChange: actualTimeGained, timeAfter: playerTimes[p_id_to_receive_bonus], round: round
                });
            }
        });
        console.log(`回合事件: 全體 +${timeBonusValue} 時間 (${characterSettings[playerCharacterSelections[skillHolder]].name}技)`);
    }

    for (const p of players) {
        const playerActionData = playerActions[p];
        const actionsToCheck = Array.isArray(playerActionData) ? playerActionData : [playerActionData];
        for (const action of actionsToCheck) {
            if (action && action !== '休息' && !cardData[action]) {
                console.error(`嚴重錯誤：玩家 ${p} 選擇的卡片ID ${action} 在 cardData 中找不到！`);
                alert(`錯誤：找不到卡片 ${action} 的資料！遊戲可能無法繼續。`);
                document.getElementById('nextRoundBtn').disabled = true; return;
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
                if (skillInfo && skillInfo.type === "ENHANCED_REST") recoveryAmount = skillInfo.value;
                playerTimes[p] = Math.min(playerTimes[p] + recoveryAmount, MAX_TIME);
                const actualRecovery = playerTimes[p] - timeBeforeRest;

                if (actualRecovery >= 0) {
                    const skillText = (recoveryAmount !== BASE_REST_RECOVERY_AMOUNT && skillInfo) ? ` (${characterSettings[playerCharacterSelections[p]].name}技)` : '';
                    const detailMsg = `休息恢復: +${actualRecovery} 時間${skillText}`;
                    timeline[p].push({
                        type: 'rest', subtype: 'recover', detail: detailMsg,
                        timeChange: actualRecovery, timeAfter: playerTimes[p], round: round
                    });
                    console.log(`玩家行動: ${p} ${detailMsg}`);
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
        if (indexA === -1 && indexB === -1) return 0; if (indexA === -1) return 1; if (indexB === -1) return -1;
        return indexA - indexB;
    });

    for (const cardId of chosenCardIds) {
        const bidders = choiceCount[cardId];
        const currentCardInfo = cardData[cardId];
        if (!currentCardInfo) { console.error(`NextRound錯誤: 處理競標卡片ID ${cardId} 無資料`); continue; }

        if (bidders.length === 1) {
            const p = bidders[0];
            const originalPrice = currentCardInfo.price;
            const actualCost = getAdjustedCardCost(p, originalPrice, 'direct_buy');
            const skillText = actualCost < originalPrice ? ` [技]` : '';
            const detailMsg = `直接購買: ${currentCardInfo.name} (原價 ${originalPrice}, 實花 ${actualCost}${skillText})`;

            if (playerTimes[p] >= actualCost) {
                playerTimes[p] -= actualCost;
                timeline[p].push({
                    type: 'buy', subtype: 'direct', detail: detailMsg,
                    timeChange: -actualCost, timeAfter: playerTimes[p], round: round
                });
                console.log(`玩家行動: ${p} ${detailMsg}`);
                const indexInAvailable = availableCards.indexOf(cardId);
                if (indexInAvailable > -1) {
                     availableCards.splice(indexInAvailable, 1);
                     console.log(`卡片移除: ${cardId} (${currentCardInfo.name}) 已被購買`);
                }
            } else {
                const failDetail = `購買失敗: ${currentCardInfo.name} (需 ${actualCost}, 餘 ${playerTimes[p]})`;
                timeline[p].push({
                    type: 'buy_fail', subtype: 'insufficient_funds_direct', detail: failDetail,
                    timeChange: 0, timeAfter: playerTimes[p], round: round
                });
                console.log(`玩家行動: ${p} ${failDetail}`);
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
                    console.log(`卡片移除: ${cardId} (${currentCardInfo.name}) 已被 ${biddingResultOutcome.winner} 競標獲得`);
                }
            }
            // resolveBidding 已處理相關 timeline 和 playerTimes 更新
            if (biddingResultOutcome.needsConsolationDraw && biddingResultOutcome.tiedPlayersForConsolation.length > 0) {
                await startConsolationDrawPhase(biddingResultOutcome.tiedPlayersForConsolation);
                // startConsolationDrawPhase 內部會處理安慰性抽牌獲得的卡片從 availableCards 移除
            }
        }
    }

    if (biddingWasCancelledByUserAction) {
        console.log("回合中止: 競標被使用者取消。"); return;
    }

    const initialMarketCardsThisRound = gameStateBeforeNextRound.marketCards;
    if (initialMarketCardsThisRound && initialMarketCardsThisRound.length > 0) {
        console.log(`回合結束: 清理市場卡 ${initialMarketCardsThisRound.join(', ')}`);
        initialMarketCardsThisRound.forEach(cardIdToRemove => {
            const indexInAvailable = availableCards.indexOf(cardIdToRemove);
            if (indexInAvailable > -1) { // 如果這張初始市場卡還在 availableCards (表示未被任何方式獲取)
                availableCards.splice(indexInAvailable, 1);
                console.log(`市場棄牌: ${cardData[cardIdToRemove].name} (ID ${cardIdToRemove}) 未售出`);
            }
        });
    }

    round++;
    document.getElementById('roundTitle').textContent = '第' + round + '回合';
    playerActions = {};
    players.forEach(p => { playerTurnChoices[p] = { count: 0, actions: [], firstChoiceWasCard: false }; });
    document.getElementById('nextRoundBtn').disabled = true;
    updateAllTimeBars();
    renderTimeline();
    gameStateBeforeNextRound = null;
    console.log(`回合結束: 前進至第 ${round} 回合。可用卡牌剩餘 ${availableCards.length} 張。`);

    const marketAreaContainer = document.getElementById('marketArea');
    drawMarket(); // 必須在檢查 buttons 前調用，drawMarket 會更新市場標題和資訊
    const marketAreaButtons = marketAreaContainer.getElementsByTagName('button');

    if (availableCards.length === 0 && marketAreaButtons.length === 0 && determineMaxMarketSelectionCount() === 0) {
        // 如果沒有可用卡片，且 drawMarket 後市場也沒按鈕 (因為 maxSelection 為 0)，則遊戲結束
        alert("所有卡片均已處理完畢，遊戲結束！");
        document.getElementById('marketSelection').innerHTML = '<h2>遊戲結束 - 所有卡片已處理</h2>';
        document.getElementById('playerActions').style.display = 'none';
        document.getElementById('nextRoundBtn').disabled = true;
        document.getElementById('backToMarketSelectionBtn').style.display = 'none';
        return;
    }

    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('playerActions').style.display = 'none';
    selectedMarket = []; // 由 drawMarket() 內部處理
    marketCards = [];    // 本回合的市場卡將在 confirmMarket() 時設定
}


// ========= 競標相關函式 =========
async function performBiddingProcess(cardId, bidders) { // bidders 是 playerID 陣列
    return new Promise((resolve) => {
        currentBidding = { // 重置當前競標狀態
            cardId: cardId,
            bidders: [...bidders], // 複製一份，以防外部修改
            bids: [], // { player: playerId, bid: amount }
            step: 0,
            resolvePromise: resolve, // 將 resolve 函式存起來，供 resolveBidding 或 cancelBidding 調用
            needsConsolationDraw: false,
            tiedPlayersForConsolation: []
        };
        promptNextBidder(); // 開始第一個出價者的提示
    });
}

function promptNextBidder() {
    const oldWindow = document.querySelector('.bidding-window');
    if (oldWindow) oldWindow.remove();

    if (currentBidding.step >= currentBidding.bidders.length) { // 所有人都出過價了
        resolveBidding();
        return;
    }

    const biddingWindow = document.createElement('div');
    biddingWindow.className = 'bidding-window';

    const player = currentBidding.bidders[currentBidding.step];
    const maxBid = playerTimes[player];
    const cardInfoForBid = cardData[currentBidding.cardId];

    if (!cardInfoForBid) {
        console.error(`競標提示錯誤: 找不到卡片ID ${currentBidding.cardId} 的資料！`);
        if (currentBidding.resolvePromise) {
            currentBidding.resolvePromise({ userCancelled: true, bidResolvedWithoutConsolation: false, winner: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] }); // 以取消狀態結束
        }
        currentBidding = { cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] }; // 重設
        return;
    }
    const minBid = cardInfoForBid.price;
    const playerCharKey = playerCharacterSelections[player];
    const playerCharDisplayName = characterSettings[playerCharKey].name;

    biddingWindow.innerHTML = `<h3>玩家 ${player} (${playerCharDisplayName}) 出價 (擁有時間: ${maxBid})</h3>
                             <p>競標 ${cardInfoForBid.name} (原價/最低出價: ${minBid})</p>`;

    if (maxBid >= minBid) {
        for (let bid = minBid; bid <= maxBid; bid++) {
            const bidBtn = document.createElement('button');
            bidBtn.textContent = `出價 ${bid}`;
            bidBtn.onclick = () => handleBid(player, bid);
            biddingWindow.appendChild(bidBtn);
        }
    } else {
        biddingWindow.innerHTML += `<p>提示: 您的時間不足 ${minBid}，無法對此卡片進行最低出價。</p>`;
    }

    const passBtn = document.createElement('button');
    passBtn.textContent = '放棄出價 (Pass)';
    passBtn.style.backgroundColor = '#f44336'; // 紅色提示放棄
    passBtn.onclick = () => handleBid(player, 0); // 出價0代表Pass
    biddingWindow.appendChild(passBtn);

    if (currentBidding.step > 0) { // 如果不是第一個出價者，提供返回按鈕
        const backBtn = document.createElement('button');
        backBtn.textContent = '← 返回上一位出價者';
        backBtn.style.backgroundColor = '#ff9800'; // 橙色
        backBtn.onclick = () => {
            currentBidding.step--;
            // 移除上一個玩家對此卡的最後一次出價記錄 (如果有的話)
            // bids 裡可能有多個玩家的記錄，要找到屬於上一個玩家的最後一個對此卡的記錄
            // 簡化：假設 bids 是按順序 push 的，pop() 移除的就是上一個玩家的最後出價
            // 但如果允許同一玩家多次修改出價，這裡會複雜。目前 handleBid 是直接 step++
            // 所以 bids 的最後一個元素就是剛才 step-- 對應的那個玩家的 bid
            if (currentBidding.bids.length > 0 && currentBidding.bids[currentBidding.bids.length-1].player === currentBidding.bidders[currentBidding.step+1]) { // 簡單檢查
                 currentBidding.bids.pop();
            } else {
                // 如果 pop 的不是預期的，可能需要更複雜的邏輯來定位並移除 bids 裡特定玩家對此卡的最新出價
                // 為了安全，如果不能確定，寧可不 pop，讓玩家重新出價覆蓋。
                console.warn("競標返回警告: 無法安全移除上一個出價記錄，玩家需重新出價。")
            }
            promptNextBidder(); // 重新提示上一個出價者
        };
        biddingWindow.appendChild(backBtn);
    }

    const cancelBtnElement = document.createElement('button');
    cancelBtnElement.textContent = '✖ 取消整個競標 (回溯本回合行動)';
    cancelBtnElement.style.backgroundColor = '#607d8b'; // 藍灰色
    cancelBtnElement.onclick = () => cancelBidding(true); // true 表示完全取消並回溯
    biddingWindow.appendChild(cancelBtnElement);

    document.body.appendChild(biddingWindow);
}

function handleBid(player, bidAmount) {
    // 記錄玩家對當前競標卡片的出價
    // 如果玩家之前已對此卡出過價，應替換舊出價（目前邏輯是每人只出一次）
    // 簡單處理：直接 push，resolveBidding 時會取每個玩家的最後出價（如果允許多次出價）
    // 但目前 step++，所以每個 player 只會 push 一次
    currentBidding.bids.push({ player: player, bid: bidAmount, cardId: currentBidding.cardId });
    console.log(`競標處理: 玩家 ${player} 對卡片 ${currentBidding.cardId} 出價 ${bidAmount}`);
    currentBidding.step++;
    promptNextBidder(); // 提示下一個，或結束競標
}

function resolveBidding() {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    const cardIdBeingBidOn = currentBidding.cardId;
    const cardInfo = cardData[cardIdBeingBidOn] || { name: `未知卡片 ${cardIdBeingBidOn}`, price: 0 };
    // 從 currentBidding.bids 中獲取與當前 cardIdBeingBidOn 相關的有效出價
    const relevantBids = currentBidding.bids.filter(b => b.cardId === cardIdBeingBidOn && b.bid > 0);
    const currentRoundForEvent = gameStateBeforeNextRound ? gameStateBeforeNextRound.round : round;

    let biddingOutcome = {
        userCancelled: false, bidResolvedWithoutConsolation: false, winner: null,
        needsConsolationDraw: false, tiedPlayersForConsolation: []
    };

    if (relevantBids.length === 0) {
        const detailMsg = `全員放棄: ${cardInfo.name} (原價 ${cardInfo.price})`;
        currentBidding.bidders.forEach(p => { // 這裡的bidders是最初參與此卡競標的人
            // 確保只為真正參與了本次出價（即使是放棄）的人添加事件
            const playerSpecificBidRecord = currentBidding.bids.find(b => b.player === p && b.cardId === cardIdBeingBidOn);
            if(playerSpecificBidRecord) { // 如果該玩家確實有過操作(哪怕是出價0)
                 timeline[p].push({
                    type: 'bidding', subtype: 'pass_all', detail: detailMsg,
                    timeChange: 0, timeAfter: playerTimes[p], round: currentRoundForEvent
                });
            }
        });
        console.log(`競標事件: ${detailMsg}`);
        biddingOutcome.bidResolvedWithoutConsolation = true;
    } else {
        let maxBidValue = 0;
        relevantBids.forEach(b => { if (b.bid > maxBidValue) maxBidValue = b.bid; });
        const potentialWinners = relevantBids.filter(b => b.bid === maxBidValue).map(b => b.player);
        // 去重，以防萬一（雖然目前邏輯下不應重複）
        const uniquePotentialWinners = [...new Set(potentialWinners)];


        if (uniquePotentialWinners.length === 1) {
            const winner = uniquePotentialWinners[0];
            const actualCost = getAdjustedCardCost(winner, maxBidValue, 'bid_win');
            const skillText = actualCost < maxBidValue ? ' [技]' : '';
            const detailMsg = `競標成功: ${cardInfo.name} (出價 ${maxBidValue}, 實花 ${actualCost}${skillText})`;

            playerTimes[winner] -= actualCost;
            timeline[winner].push({
                type: 'bidding', subtype: 'win', detail: detailMsg,
                timeChange: -actualCost, timeAfter: playerTimes[winner], round: currentRoundForEvent
            });
            timeline[winner].push({ // 為勝利者添加的 phase_tick
                type: 'phase_tick', subtype: 'bid_win_marker',
                detail: `競標註記: ${cardInfo.name} (您已得標)`,
                timeChange: 0, timeAfter: playerTimes[winner], round: currentRoundForEvent
            });
            console.log(`競標事件: ${detailMsg.replace('競標成功: ', `玩家 ${winner} `)}`);

            currentBidding.bids.filter(b => b.cardId === cardIdBeingBidOn).forEach(({ player: p, bid: bVal }) => {
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
            console.log(`競標事件: ${cardInfo.name} 平手 (最高出價 ${maxBidValue}), 參與者: ${uniquePotentialWinners.join(', ')}`);
            let skill4Winner = null;
            const playersWithSkill4InTie = uniquePotentialWinners.filter(p_id =>
                playerCharacterSkills[p_id] && playerCharacterSkills[p_id].type === "WIN_BID_TIE"
            );

            if (playersWithSkill4InTie.length === 1) skill4Winner = playersWithSkill4InTie[0];
            else if (playersWithSkill4InTie.length > 1) console.log(`競標事件: 多名平手者有技能「追逐夢想的人」，技能不獨佔解決。`);

            if (skill4Winner) {
                const actualCost = getAdjustedCardCost(skill4Winner, maxBidValue, 'bid_win');
                const skillText = actualCost < maxBidValue ? ' [技]' : '';
                const detailMsg = `技能勝出: ${cardInfo.name} (出價 ${maxBidValue}, 實花 ${actualCost}${skillText})`;
                playerTimes[skill4Winner] -= actualCost;
                timeline[skill4Winner].push({
                    type: 'bidding', subtype: 'win_skill', detail: detailMsg,
                    timeChange: -actualCost, timeAfter: playerTimes[skill4Winner], round: currentRoundForEvent
                });
                timeline[skill4Winner].push({ // 為技能勝利者添加的 phase_tick
                    type: 'phase_tick', subtype: 'bid_win_marker',
                    detail: `競標註記: ${cardInfo.name} (您已得標)`,
                    timeChange: 0, timeAfter: playerTimes[skill4Winner], round: currentRoundForEvent
                });
                console.log(`競標事件: ${detailMsg.replace('技能勝出: ', `玩家 ${skill4Winner} `)}`);

                currentBidding.bids.filter(b => b.cardId === cardIdBeingBidOn).forEach(({ player: p, bid: bVal }) => {
                    if (p !== skill4Winner) {
                        const detailText = uniquePotentialWinners.includes(p) ? `平手技敗: ${cardInfo.name} (出價 ${bVal})` :
                                         (bVal > 0 ? `競標失敗: ${cardInfo.name} (出價 ${bVal})` : `放棄競標: ${cardInfo.name} (未出價)`);
                        const sub_type = uniquePotentialWinners.includes(p) ? 'lose_tie_skill' : (bVal > 0 ? 'lose' : 'pass');
                        timeline[p].push({
                            type: 'bidding', subtype: sub_type, detail: detailText,
                            timeChange: 0, timeAfter: playerTimes[p], round: currentRoundForEvent
                        });
                    }
                });
                biddingOutcome.bidResolvedWithoutConsolation = true;
                biddingOutcome.winner = skill4Winner;
            } else { // 無技能解決的平手 -> 流標，觸發安慰性抽牌
                const detailMsg = `平局流標: ${cardInfo.name} (出價 ${maxBidValue})`;
                console.log(`競標事件: ${detailMsg}，準備安慰階段。`);
                uniquePotentialWinners.forEach(p_id => {
                    timeline[p_id].push({
                        type: 'bidding', subtype: 'tie_unresolved', detail: detailMsg,
                        timeChange: 0, timeAfter: playerTimes[p_id], round: currentRoundForEvent
                    });
                });
                biddingOutcome.needsConsolationDraw = true;
                biddingOutcome.tiedPlayersForConsolation = [...uniquePotentialWinners];
            }
        }
    }

    if (currentBidding.resolvePromise) {
        currentBidding.resolvePromise(biddingOutcome);
    }
    // 重設 currentBidding 移到 performBiddingProcess 調用 resolveBidding 之後，或由 cancelBidding 處理
    // currentBidding = { cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };
}

function cancelBidding(fullCancel = false) {
    const biddingWindowDom = document.querySelector('.bidding-window');
    if (biddingWindowDom) biddingWindowDom.remove();

    const promiseToResolve = currentBidding.resolvePromise;
    const biddingOutcomeOnCancel = { userCancelled: true, bidResolvedWithoutConsolation: false, winner: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };


    if (fullCancel && gameStateBeforeNextRound) {
        console.log("競標取消: 完全取消，回溯遊戲狀態至上一行動選擇點。");
        playerTimes = gameStateBeforeNextRound.playerTimes;
        timeline = gameStateBeforeNextRound.timeline; // 回溯時間軸
        round = gameStateBeforeNextRound.round;       // 回溯回合數 (通常不變，除非跨回合操作)
        availableCards = gameStateBeforeNextRound.availableCards; // 回溯可用卡牌
        marketCards = gameStateBeforeNextRound.marketCards;     // 回溯市場卡牌

        playerActions = {}; // 清空所有玩家本回合已選行動
        players.forEach(p => { // 重置技能6玩家的選擇狀態
             playerTurnChoices[p] = { count: 0, actions: [], firstChoiceWasCard: false };
        });

        document.getElementById('roundTitle').textContent = '第' + round + '回合';
        document.getElementById('nextRoundBtn').disabled = true; // 通常需要重新選擇行動

        document.getElementById('marketSelection').style.display = 'none';  // 隱藏市場選擇
        document.getElementById('playerActions').style.display = 'block';   // 顯示玩家行動區
        document.getElementById('backToMarketSelectionBtn').style.display = 'inline-block'; // 允許返回市場

        marketStep(); // 重新生成玩家行動按鈕和手動調整按鈕

        updateAllTimeBars();
        renderTimeline(); // 重新渲染回溯後的時間軸

        if (promiseToResolve) {
            promiseToResolve(biddingOutcomeOnCancel);
        }
    } else { // 只是關閉當前競標窗口，但不回溯整個回合行動 (例如，如果只是返回上一步出價)
        console.log("競標取消: 關閉當前出價窗口 (非完全回溯)。");
        if (promiseToResolve) {
            // 這種情況下，可能不應該直接 resolve，而是由 promptNextBidder 或其他邏輯處理
            // 但如果 cancelBidding 總是意味著整個卡片的競標終止，那麼 resolve 是必要的。
            // 這裡假設 userCancelled: true 總是意味著對這張卡的競標結束了。
            promiseToResolve(biddingOutcomeOnCancel);
        }
    }
    // 統一重設競標狀態
    currentBidding = { cardId: null, bidders: [], bids: [], step: 0, resolvePromise: null, needsConsolationDraw: false, tiedPlayersForConsolation: [] };
    gameStateBeforeNextRound = null; // 無論如何，使用過或已回溯，就清除
}


// ========= 安慰性抽牌/購買階段 (您提供的版本，已整合訊息格式) =========
async function startConsolationDrawPhase(tiedPlayersList) {
    console.log(`安慰階段: 開始 (參與者: ${tiedPlayersList.join(', ')})`);
    const sortedTiedPlayers = tiedPlayersList.sort((a, b) => PLAYER_ID_MAP.indexOf(a) - PLAYER_ID_MAP.indexOf(b));

    // 1. 創建本輪安慰性抽牌的專用可選卡池 (排除本回合市場上已出現的卡片)
    let consolationSelectableCards = availableCards.filter(
        cardId => !(gameStateBeforeNextRound.marketCards.includes(cardId))
    );

    for (const player of sortedTiedPlayers) {
        if (consolationSelectableCards.length === 0) {
            const noCardDetail = `安慰選擇: 無卡可選`;
            console.log(`安慰階段: ${noCardDetail.replace('安慰選擇: ', `玩家 ${player} `)} (已排除本回合市場卡後)`);
            timeline[player].push({
                type: 'phase_info', subtype: 'consolation_no_cards',
                detail: noCardDetail,
                timeChange: 0, timeAfter: playerTimes[player], round: round
            });
            // alert("市場已無合適卡牌，安慰性購買中止。"); // 可選，但 console 已記錄
            // 繼續檢查下一位玩家，因為此訊息是針對當前玩家的
            // 如果池子一直是空的，後續玩家也會進入這個分支
            // break; // 不應該 break，讓所有 tiedPlayers 都記錄 "無卡可選"
        } else {
            console.log(`安慰階段: 輪到玩家 ${player} 選擇 (可選池數量: ${consolationSelectableCards.length})`);
            const chosenCardId = await promptConsolationCardChoice(player, [...consolationSelectableCards]);

            if (!chosenCardId) {
                const skipDetail = `安慰選擇: 放棄 (未選卡)`;
                console.log(`安慰階段: ${skipDetail.replace('安慰選擇: ', `玩家 ${player} `)}`);
                timeline[player].push({
                    type: 'draw_decline', subtype: 'consolation_choice_skip', detail: skipDetail,
                    timeChange: 0, timeAfter: playerTimes[player], round: round
                });
                // renderTimeline(); // 由 nextRound 統一調用
                // continue; // 輪到下一位玩家 (已在 for 迴圈中)
            } else {
                 // 2. 一旦卡片被選中考慮，立即從各相關列表中移除
                consolationSelectableCards = consolationSelectableCards.filter(id => id !== chosenCardId);
                const indexInGlobalAvailable = availableCards.indexOf(chosenCardId);
                if (indexInGlobalAvailable > -1) {
                    availableCards.splice(indexInGlobalAvailable, 1);
                    console.log(`安慰階段: 卡片 ${chosenCardId} 被 ${player} 選中考慮，已從主牌庫移除`);
                } else {
                    console.warn(`安慰階段警告: 卡片 ${chosenCardId} 被選中，但未在主牌庫找到？！`);
                }

                const chosenCardInfo = cardData[chosenCardId]; // 此時應能找到
                if (!chosenCardInfo) { // 防禦性檢查
                     console.error(`安慰階段錯誤: 玩家 ${player} 選擇無效卡片ID ${chosenCardId} (在cardData中未找到)`);
                     continue;
                }


                console.log(`安慰階段: 玩家 ${player} 考慮 ${chosenCardInfo.name} (ID: ${chosenCardId})`);
                const originalPrice = chosenCardInfo.price;
                const actualCost = getAdjustedCardCost(player, originalPrice, 'consolation_draw');
                const wantsToBuy = await promptConsolationPurchase(player, chosenCardInfo, actualCost);

                if (wantsToBuy && playerTimes[player] >= actualCost) {
                    playerTimes[player] -= actualCost;
                    const skillText = actualCost < originalPrice ? ' [技]' : '';
                    const detailMsg = `安慰獲得: ${chosenCardInfo.name} (原價 ${originalPrice}, 花費 ${actualCost}${skillText})`;
                    timeline[player].push({
                        type: 'draw_acquire', subtype: 'consolation_purchase', detail: detailMsg,
                        timeChange: -actualCost, timeAfter: playerTimes[player], round: round
                    });
                    console.log(`安慰階段: ${detailMsg.replace('安慰獲得: ', `玩家 ${player} `)}`);
                    // 卡片已在選中考慮時從 availableCards 移除
                } else {
                    const reason = (wantsToBuy && playerTimes[player] < actualCost) ? '時間不足' : '放棄購買';
                    const detailMsg = `安慰放棄: ${chosenCardInfo.name} (${reason})`;
                    timeline[player].push({
                        type: 'draw_decline', subtype: 'consolation_purchase_decline', detail: detailMsg,
                        timeChange: 0, timeAfter: playerTimes[player], round: round
                    });
                    console.log(`安慰階段: ${detailMsg.replace('安慰放棄: ', `玩家 ${player} `)}`);
                    // 卡片已在選中考慮時從 availableCards 移除，所以這裡不需額外處理 "返回市場"
                }
            }
        }
        updateTimeBar(player); // 在每個玩家操作後更新其時間條
    } // 結束 for (const player of sortedTiedPlayers)

    console.log("安慰階段: 結束");
    // updateAllTimeBars(); // 由 nextRound 統一調用
    // renderTimeline(); // 由 nextRound 統一調用
}

async function promptConsolationCardChoice(player, cardsForChoice) { // cardsForChoice 是已過濾的安慰性可選牌池
    return new Promise(resolve => {
        const oldWindow = document.querySelector('.consolation-choice-window');
        if (oldWindow) oldWindow.remove();

        if (!cardsForChoice || cardsForChoice.length === 0) { // 再次檢查傳入的池
            // alert(`玩家 ${player} 無卡可供選擇進行安慰性購買。`); // 已在 startConsolationDrawPhase 處理
            resolve(null);
            return;
        }

        const windowDiv = document.createElement('div');
        windowDiv.className = 'bidding-window consolation-choice-window';
        const playerCharKey = playerCharacterSelections[player];
        const playerCharDisplayName = characterSettings[playerCharKey]?.name || '';

        windowDiv.innerHTML = `
            <h3>玩家 ${player} ${playerCharDisplayName ? `(${playerCharDisplayName})` : ''} - 安慰卡選擇</h3>
            <p>請從下列剩餘卡片中選擇一張進行考慮：</p>
        `;
        const cardListDiv = document.createElement('div');
        cardListDiv.style.maxHeight = '300px'; cardListDiv.style.overflowY = 'auto'; cardListDiv.style.marginBottom = '15px';

        cardsForChoice.forEach(cardId => {
            const cardInfo = cardData[cardId];
            if (!cardInfo) {console.error(`安慰選擇提示錯誤: 卡片ID ${cardId} 無資料`); return;}
            const btn = document.createElement('button');
            btn.textContent = `${cardInfo.name} (原價: ${cardInfo.price})`;
            btn.style.display = 'block'; btn.style.margin = '5px auto';
            btn.onclick = () => { windowDiv.remove(); resolve(cardId); };
            cardListDiv.appendChild(btn);
        });
        windowDiv.appendChild(cardListDiv);

        const passButton = document.createElement('button');
        passButton.textContent = '放棄選擇'; passButton.style.marginTop = '10px';
        passButton.onclick = () => { windowDiv.remove(); resolve(null); };
        windowDiv.appendChild(passButton);
        document.body.appendChild(windowDiv);
        windowDiv.focus();
    });
}

async function promptConsolationPurchase(player, cardInfo, actualCost) {
    return new Promise(resolve => {
        const oldWindow = document.querySelector('.consolation-purchase-window');
        if (oldWindow) oldWindow.remove();
        const windowDiv = document.createElement('div');
        windowDiv.className = 'bidding-window consolation-purchase-window';
        const playerCharKey = playerCharacterSelections[player];
        const playerCharDisplayName = characterSettings[playerCharKey]?.name || '';

        const cardIdForDisplay = Object.keys(cardData).find(key => cardData[key].name === cardInfo.name && cardData[key].price === cardInfo.price) || currentBidding.cardId; // 備用

        windowDiv.innerHTML = `
            <h3>玩家 ${player} ${playerCharDisplayName ? `(${playerCharDisplayName})` : ''} - 安慰性購買</h3>
            <p>您選擇了：<strong>${cardInfo.name}</strong> (ID: ${cardIdForDisplay})</p>
            <p>效果：${cardInfo.effect || '無效果描述'}</p>
            <p>原價: ${cardInfo.price}, 您的花費: <strong>${actualCost}</strong></p>
            <p>您目前時間: ${playerTimes[player]}</p>`;

        const buyButton = document.createElement('button');
        buyButton.textContent = `購買 (花費 ${actualCost})`;
        if (playerTimes[player] < actualCost) {
            buyButton.disabled = true; buyButton.title = "時間不足";
        }
        buyButton.onclick = () => { windowDiv.remove(); resolve(true); };

        const passButton = document.createElement('button');
        passButton.textContent = '放棄';
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
    if (!playerTimes.hasOwnProperty(player)) return; // 防禦
    const time = playerTimes[player];
    const barInner = document.getElementById('bar' + player);
    if (!barInner) return;

    const percentage = Math.max(0, (time / MAX_TIME * 100));
    barInner.style.width = percentage + '%';
    barInner.textContent = time;

    if (time <= 0) {
        barInner.style.background = '#424242'; // 深灰色，比黑色柔和
        barInner.textContent = '時間耗盡';
    } else if (time <= MAX_TIME * (1 / 3)) { // 例如 12 * 1/3 = 4
        barInner.style.background = '#d32f2f'; // 紅色
    } else if (time <= MAX_TIME * (2 / 3)) { // 例如 12 * 2/3 = 8
        barInner.style.background = '#ff9800'; // 橘色
    } else {
        barInner.style.background = '#4caf50'; // 綠色
    }
}

function updateAllTimeBars() {
    players.forEach(p_id => updateTimeBar(p_id));
}

function renderTimeline() {
    players.forEach(p_id => {
        const eventsDiv = document.getElementById('events' + p_id);
        if (!eventsDiv) return;
        eventsDiv.innerHTML = ''; // 清空現有事件

        if (!timeline[p_id] || timeline[p_id].length === 0) {
            // eventsDiv.innerHTML = '<p style="font-size:0.9em; color:#757575;">尚無行動記錄</p>';
            return;
        }

        timeline[p_id].forEach(event => {
            const segment = document.createElement('div');
            segment.className = 'event';
            if (event.type) segment.classList.add(event.type.toLowerCase()); // 統一小寫
            if (event.subtype) segment.classList.add(event.subtype.toLowerCase());

            let calculatedWidthPx = MIN_EVENT_SEGMENT_WIDTH;
            const timeChangeNum = Number(event.timeChange);
            if (!isNaN(timeChangeNum) && timeChangeNum !== 0) {
                calculatedWidthPx = Math.abs(timeChangeNum) * TIME_UNIT_WIDTH;
            }
            calculatedWidthPx = Math.max(calculatedWidthPx, MIN_EVENT_SEGMENT_WIDTH);
            segment.style.width = calculatedWidthPx + 'px';
            segment.style.height = EVENT_SEGMENT_HEIGHT;

            let symbol = '?';
            // 根據 type 和 subtype 決定符號
            if (event.type === 'rest') symbol = '休';
            else if (event.type === 'buy') symbol = '購';
            else if (event.type === 'buy_fail') symbol = 'X';
            else if (event.type === 'bidding') {
                if (event.subtype === 'win' || event.subtype === 'win_skill') symbol = '標✓';
                else if (event.subtype === 'tie_unresolved' || event.subtype === 'tie_fail') symbol = '平!'; // tie_fail 是舊的，tie_unresolved 是新的
                else if (event.subtype === 'pass_all') symbol = '全棄';
                else if (event.subtype === 'pass') symbol = '過';
                else if (event.subtype === 'lose' || event.subtype === 'lose_tie_skill') symbol = '敗';
                else symbol = '競';
            } else if (event.type === 'phase_tick') symbol = '●';
            else if (event.type === 'phase_info') symbol = 'i';
            else if (event.type === 'skill_effect') symbol = '技';
            else if (event.type === 'draw_acquire') symbol = '抽✓';
            else if (event.type === 'draw_decline') symbol = '抽X';
            else if (event.type === 'manual_adjust') {
                symbol = event.subtype === 'plus' ? '➕' : '➖';
            }
            segment.textContent = symbol;

            const tip = document.createElement('div');
            tip.className = 'tooltip';
            // 時間軸訊息格式: "狀態描述: 卡片名 (附加資訊)"
            let detailStr = event.detail || "（無詳細資料）";
            let roundStr = (event.round !== undefined) ? `(R${event.round}) ` : "";
            let timeChangeDisplay = "";
            if (event.timeChange !== undefined && event.timeChange !== null) {
                timeChangeDisplay = ` → ${event.timeChange > 0 ? '+' : ''}${event.timeChange} 時`;
            }
            tip.innerText = `${roundStr}${detailStr}${timeChangeDisplay} (餘 ${event.timeAfter === undefined ? 'N/A' : event.timeAfter})`;
            segment.appendChild(tip);

            segment.onclick = () => { // 點擊放大/縮小，並確保tooltip可見
                const isEnlarged = segment.classList.toggle('enlarged');
                // 如果tooltip在放大時被遮擋，可能需要調整z-index或顯示策略
            };
            eventsDiv.appendChild(segment);
        });
    });
}

// 匯出遊戲紀錄函式 (目前為空，待實現)
function downloadConsoleLog() {
    alert("匯出遊戲紀錄功能尚未實作。");
    // 實作參考：收集 console 訊息或遊戲狀態，轉換為文字檔下載
    // let logData = "遊戲紀錄...\n"; // 從某處獲取log
    // const blob = new Blob([logData], { type: 'text/plain;charset=utf-8' });
    // const link = document.createElement('a');
    // link.href = URL.createObjectURL(blob);
    // link.download = `遊戲紀錄_${new Date().toISOString().slice(0,10)}.txt`;
    // link.click();
    // URL.revokeObjectURL(link.href);
    console.log("操作提示: 請求匯出遊戲紀錄 (功能待實作)。");
}