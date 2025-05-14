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

// ========= 常數與資料設定 =========
let cardData = null;
let characterSettings = null;
let characterNames = [];

const MAX_TIME = 12;
const REST_RECOVERY_AMOUNT = 6;

const TIME_UNIT_WIDTH = 30;
const MIN_EVENT_SEGMENT_WIDTH = TIME_UNIT_WIDTH; // 讓0時間變化的事件也佔據1個單位寬
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
        document.getElementById('confirmCharactersButton').style.backgroundColor = ''; // 恢復預設綠色
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
        playerTimes[p_id] = character.startTime;

        document.querySelector(`#player${p_id} > h3`).textContent = `${p_id}玩家 (${character.name})`;
        document.querySelector(`#timeline${p_id} > h3`).textContent = `${p_id}玩家 (${character.name}) (${character.specialAbility}) 時間軸`;

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
        const maxSelection = Math.min(3, availableCards.length);
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
    const maxSelection = Math.min(3, availableCards.length);
    if (availableCards.length === 0) {
        document.getElementById('confirmMarket').disabled = true;
    } else {
        document.getElementById('confirmMarket').disabled = selectedMarket.length !== maxSelection;
    }
}

function confirmMarket() {
    const maxSelection = Math.min(3, availableCards.length);
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
    players.forEach(p => {
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

// ========= 玩家行動函式 =========
function selectAction(player, choice, clickedButton) {
    const actionButtonsContainer = document.getElementById('actions' + player);
    const buttons = Array.from(actionButtonsContainer.children);

    if (playerActions[player] === choice) {
        playerActions[player] = null;
        // 重新啟用按鈕，但要根據費用判斷
        // 重新建立該玩家的 action 按鈕們
        updateActionButtonsForPlayer(player);
    } else {
        playerActions[player] = choice;
        buttons.forEach(btn => {
            if (btn === clickedButton) {
                btn.classList.add('selected');
                btn.disabled = false;
            } else {
                btn.disabled = true;
                btn.classList.remove('selected');
            }
        });
    }
    checkAllActions();
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
    const allPlayersActed = players.every(p => playerActions[p] !== null && playerActions[p] !== undefined);
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

    document.getElementById('backToMarketSelectionBtn').style.display = 'none';
    players.forEach(p => {
        const manualControls = document.getElementById('manualControls' + p);
        if (manualControls) manualControls.style.display = 'none';
    });

    for (const p of players) {
        const action = playerActions[p];
        if (action && action !== '休息') {
            if (!cardData[action]) {
                console.error(`嚴重錯誤：玩家 ${p} 選擇的卡片ID ${action} 在 cardData 中找不到！`);
                alert(`錯誤：找不到卡片 ${action} 的資料！遊戲可能無法繼續。`);
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
        const action = playerActions[p];
        if (action === '休息') {
            const timeBeforeRestThisPlayer = playerTimes[p];
            playerTimes[p] = Math.min(playerTimes[p] + REST_RECOVERY_AMOUNT, MAX_TIME);
            timeline[p].push({
                type: 'rest',
                subtype: 'recover',
                detail: `恢復時間：+${REST_RECOVERY_AMOUNT}`,
                timeChange: playerTimes[p] - timeBeforeRestThisPlayer,
                timeAfter: playerTimes[p],
                round: round
            });
        } else if (action) {
            choiceCount[action] = (choiceCount[action] || []).concat(p);
        }
    });

    let biddingWasCancelledByUserAction = false;
    const chosenCardIds = Object.keys(choiceCount).map(id => parseInt(id));

    for (const cardId of chosenCardIds) {
        const bidders = choiceCount[cardId];
        const currentCardInfo = cardData[cardId];

        if (!currentCardInfo) {
            console.error(`nextRound: 迴圈中卡片ID ${cardId} 的資料在 cardData 中找不到，跳過處理。`);
            continue;
        }

        if (bidders.length === 1) {
            const p = bidders[0];
            const price = currentCardInfo.price;
            if (playerTimes[p] >= price) { // 理論上 marketStep 已確保此條件
                playerTimes[p] -= price;
                timeline[p].push({
                    type: 'buy',
                    subtype: 'direct',
                    detail: `購買成功：${currentCardInfo.name}(價${price})`,
                    timeChange: -price,
                    timeAfter: playerTimes[p],
                    round: round
                });
            } else {
                timeline[p].push({
                    type: 'buy_fail',
                    subtype: 'insufficient_funds_direct',
                    detail: `購買失敗：${currentCardInfo.name}(需${price}，餘${playerTimes[p]})`,
                    timeChange: 0,
                    timeAfter: playerTimes[p],
                    round: round
                });
            }
        } else if (bidders.length > 1) {
            console.log(`卡片 (${currentCardInfo.name}) 進入競標。參與者: ${bidders.join(', ')}`);

            // 預先為每位競標者加上一個 placeholder
            const placeholderIndexes = {};
            bidders.forEach(p => {
                const placeholder = {
                    type: 'phase_tick',
                    subtype: 'pre_bidding_placeholder',
                    detail: `準備競標：${currentCardInfo.name}`,
                    timeChange: 0,
                    timeAfter: playerTimes[p],
                    round: round
                };
                placeholderIndexes[p] = timeline[p].length;
                timeline[p].push(placeholder);
            });

            const userCancelledBiddingWindow = await performBiddingProcess(cardId, bidders);

            if (userCancelledBiddingWindow) {
                biddingWasCancelledByUserAction = true;
                console.log(`卡片 (${currentCardInfo.name}) 的競標取消`);
                break;
            }

            let winnerOfThisBid = null;
            for (const p_bidder of bidders) {
                if (timeline[p_bidder] && timeline[p_bidder].length > 0) {
                    const recentEvent = timeline[p_bidder][timeline[p_bidder].length - 1];
                    if (recentEvent && recentEvent.type === 'bidding' && recentEvent.subtype === 'win' &&
                        recentEvent.round === round && recentEvent.detail && recentEvent.detail.includes(currentCardInfo.name)) {
                        winnerOfThisBid = p_bidder;
                        break;
                    }
                }
            }

            // 根據勝敗與放棄情況決定是否替換 placeholder 或移除
            bidders.forEach(p => {
                const lastIndex = placeholderIndexes[p];
                const isLoser = (p !== winnerOfThisBid);
                const gaveUp = timeline[p].some(
                    event => event.type === 'bidding' &&
                    event.subtype === 'give_up' &&
                    event.round === round
                );

                if (isLoser || gaveUp) {
                    timeline[p].splice(lastIndex, 1);
                } else {
                    timeline[p][lastIndex] = {
                        ...timeline[p][lastIndex],
                        subtype: 'loser_tick',
                        detail: `競標成功：${currentCardInfo.name}`
                    };
                }
            });
        }
    }

    if (biddingWasCancelledByUserAction) {
        console.log("nextRound processing halted due to user cancelling a bid. State was rolled back by cancelBidding function.");
        return;
    }

    const cardsOnMarketThisRound = gameStateBeforeNextRound.marketCards;
    if (cardsOnMarketThisRound && cardsOnMarketThisRound.length > 0) {
        console.log(`回合 ${round} 結束，棄置市場上出現過的卡片: ${cardsOnMarketThisRound.join(', ')}`);
        cardsOnMarketThisRound.forEach(cardIdToRemove => {
            const indexInAvailable = availableCards.indexOf(cardIdToRemove);
            if (indexInAvailable > -1) {
                availableCards.splice(indexInAvailable, 1);
                const cardInfo = cardData[cardIdToRemove] || {
                    name: `ID ${cardIdToRemove}`
                };
                console.log(`卡片 ${cardIdToRemove} (${cardInfo.name}) 已從可用卡片池中移除`);
            } else {
                const cardInfo = cardData[cardIdToRemove] || {
                    name: `ID ${cardIdToRemove}`
                };
                console.warn(`嘗試棄置市場卡片 ${cardIdToRemove} (${cardInfo.name}) 時，它已不在 availableCards 中 (可能已被購買或競標成功)。`);
            }
        });
        console.log(`棄置操作後，可用卡片剩餘: ${availableCards.length}`);
    }

    round++;
    document.getElementById('roundTitle').textContent = '第' + round + '回合';
    playerActions = {};
    document.getElementById('nextRoundBtn').disabled = true;
    updateAllTimeBars();
    renderTimeline();
    gameStateBeforeNextRound = null;
    console.log("nextRound completed. Advancing to round:", round);

    // 檢查遊戲結束條件
    // 如果可用卡片為0，並且當前市場選擇區也沒有卡片按鈕（表示drawMarket也抽不出卡了）
    const marketAreaButtons = document.getElementById('marketArea').getElementsByTagName('button');
    if (availableCards.length === 0 && marketAreaButtons.length === 0) {
        alert("所有卡片均已處理完畢，遊戲結束！");
        document.getElementById('marketSelection').innerHTML = '<h2>遊戲結束</h2>';
        document.getElementById('playerActions').style.display = 'none';
        return;
    }

    document.getElementById('marketSelection').style.display = 'block';
    document.getElementById('playerActions').style.display = 'none';
    selectedMarket = [];
    marketCards = [];
    drawMarket();
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

    let maxBidValue = 0;
    let winners = [];

    if (activeBids.length === 0) {
        currentBidding.bidders.forEach(p => {
            timeline[p].push({
                type: 'bidding',
                subtype: 'pass_all',
                detail: `放棄流標：${cardInfo.name}(${cardInfo.price})`,
                timeChange: 0,
                timeAfter: playerTimes[p],
                round: currentRoundForEvent
            });
        });
        console.log(`卡片 (${cardInfo.name}) 因全員放棄而流標`);
    } else {
        activeBids.forEach(b => {
            if (b.bid > maxBidValue) {
                maxBidValue = b.bid;
                winners = [b.player];
            } else if (b.bid === maxBidValue) {
                winners.push(b.player);
            }
        });

        if (winners.length === 1) {
            const winner = winners[0];
            playerTimes[winner] -= maxBidValue;
            timeline[winner].push({
                type: 'bidding',
                subtype: 'win',
                detail: `競標成功：${cardInfo.name}(出價${maxBidValue}，價${cardInfo.price})`,
                timeChange: -maxBidValue,
                timeAfter: playerTimes[winner],
                round: currentRoundForEvent
            });

            currentBidding.bids.forEach(({
                player: p,
                bid: b
            }) => {
                if (p !== winner) {
                    const detailText = b > 0 ? `競標失敗：${cardInfo.name}(出價${b})` : `放棄競標：${cardInfo.name}`;
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
            console.log(`卡片 (${cardInfo.name}) 由 ${winner} 競標成功`);
        } else {
            currentBidding.bids.forEach(({
                player: p,
                bid: b
            }) => {
                const commonProps = {
                    timeChange: 0,
                    timeAfter: playerTimes[p],
                    round: currentRoundForEvent
                };
                let detailText, sub;
                if (winners.includes(p)) {
                    sub = 'tie_fail';
                    detailText = `平手流標：${cardInfo.name}(出價${maxBidValue})`;
                } else if (b > 0) {
                    sub = 'lose';
                    detailText = `競標失敗：${cardInfo.name}(出價${b})`;
                } else {
                    sub = 'pass';
                    detailText = `放棄競標：${cardInfo.name}`;
                }
                timeline[p].push({
                    type: 'bidding',
                    subtype: sub,
                    detail: detailText,
                    ...commonProps
                });
            });
            console.log(`卡片 (${cardInfo.name}) 因出價相同而流標`);
        }
    }

    if (currentBidding.resolvePromise) {
        currentBidding.resolvePromise(false);
    }
    currentBidding = {
        cardId: null,
        bidders: [],
        bids: [],
        step: 0,
        resolvePromise: null
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

        marketStep(); // marketStep 會創建行動按鈕和 +/- 按鈕

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

            let symbol = '?';
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
                // segment.style.color = '#546E7A'; // phase_tick 顏色由CSS處理
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