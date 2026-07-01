const CARD_CACHE = {};

// ---------- INIT ----------
async function init() {
    const res = await fetch("decks.json");
    const files = await res.json();

    const container = document.getElementById("deck");

    for (const file of files) {
        await loadDeck(file, container);
    }
}

// ---------- LOAD DECK FILE (UPDATED FOR BATCH FETCH) ----------
async function loadDeck(file, container) {
    const res = await fetch(file);
    const deckText = await res.text();

    const deck = parseDeck(deckText);

    // 1. Bulk download all card images for this entire deck in a single request
    await preloadDeckImages(deck);

    const title = document.createElement("h2");
    title.textContent = file.split("/").pop().replace(".txt", "");
    container.appendChild(title);

    // 2. Render safely knowing the images are already in CARD_CACHE
    await renderDeck(deck, container);
}

// ---------- PARSE DECK TEXT (FIXED FOR MIXED-CASE SETS) ----------
function parseDeck(text) {
    const lines = text.trim().split("\n");

    let sideboard = false;
    const main = [];
    const sb = [];

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (line.toUpperCase() === "SB:") {
            sideboard = true;
            continue;
        }

        // THE FIX: Changed [A-Z0-9] to [A-Za-z0-9] so it captures lowercase set codes seamlessly
        const match = line.match(/^(\d+)\s+(.+?)\s+\[([A-Za-z0-9]+)\]$/i);

        if (!match) continue;

        const qty = parseInt(match[1], 10);
        const name = match[2].trim();
        const set = match[3].toUpperCase(); // This normalizes it to uppercase for your cache key!

        const card = { qty, name, set };

        if (sideboard) sb.push(card);
        else main.push(card);
    }

    return { cards: main, sideboard: sb };
}

// ---------- RENDER DECK ----------
async function renderDeck(deck, container) {
    // 1. RENDER MAIN DECK
    const mainWrapper = document.createElement("div");
    mainWrapper.className = "deck-columns";

    const MAIN_COLS = 6;
    const MAIN_MAX_PER_COL = 10;

    const mainColumns = Array.from({ length: MAIN_COLS }, () => {
        const col = document.createElement("div");
        col.className = "deck-column";
        mainWrapper.appendChild(col);
        return col;
    });

    let mainColIdx = 0;
    let mainColCardCount = 0;

    for (const card of deck.cards) {
        const imgUrl = await fetchCardImage(card);

        for (let i = 0; i < card.qty; i++) {
            if (mainColCardCount >= MAIN_MAX_PER_COL) {
                mainColIdx++;
                mainColCardCount = 0;
            }

            const colIndex = mainColIdx < MAIN_COLS ? mainColIdx : MAIN_COLS - 1;
            const targetColumn = mainColumns[colIndex];

            const img = document.createElement("img");
            img.className = "deck-card";
            img.src = imgUrl;
            img.title = `${card.name} [${card.set}]`;
            
            img.style.setProperty("--offset", mainColCardCount);
            img.style.zIndex = mainColCardCount;
            targetColumn.appendChild(img);
            
            mainColCardCount++;
            targetColumn.style.setProperty("--total-cards", mainColCardCount);
        }
    }
    container.appendChild(mainWrapper);

    // 2. RENDER SIDEBOARD (Only if sideboard cards exist)
    if (deck.sideboard && deck.sideboard.length > 0) {
        // Add a visual separator section
        const sbHeader = document.createElement("h3");
        sbHeader.textContent = "Sideboard";
        sbHeader.style.margin = "40px 0 20px 0";
        container.appendChild(sbHeader);

        const sbWrapper = document.createElement("div");
        sbWrapper.className = "deck-columns";

        // Configured for 5 columns wide, max 3 cards deep per column
        const SB_COLS = 5; 
        const SB_MAX_PER_COL = 3;

        const sbColumns = Array.from({ length: SB_COLS }, () => {
            const col = document.createElement("div");
            col.className = "deck-column";
            sbWrapper.appendChild(col);
            return col;
        });

        let sbColIdx = 0;
        let sbColCardCount = 0;

        for (const card of deck.sideboard) {
            const imgUrl = await fetchCardImage(card);

            for (let i = 0; i < card.qty; i++) {
                // If a column hits 3 cards, move strictly to the next column
                if (sbColCardCount >= SB_MAX_PER_COL) {
                    sbColIdx++;
                    sbColCardCount = 0;
                }

                const colIndex = sbColIdx < SB_COLS ? sbColIdx : SB_COLS - 1;
                const targetColumn = sbColumns[colIndex];

                const img = document.createElement("img");
                img.className = "deck-card";
                img.src = imgUrl;
                img.title = `${card.name} [${card.set}] (SB)`;
                
                img.style.setProperty("--offset", sbColCardCount);
                img.style.zIndex = sbColCardCount;
                targetColumn.appendChild(img);
                
                sbColCardCount++;
                targetColumn.style.setProperty("--total-cards", sbColCardCount);
            }
        }
        container.appendChild(sbWrapper);
    }
}

// ---------- COLUMN RENDER ----------
async function renderColumn(cards) {
    const col = document.createElement("div");
    col.className = "deck-column";

    for (const card of cards) {
        const imgUrl = await fetchCardImage(card);

        for (let i = 0; i < card.qty; i++) {
            const img = document.createElement("img");
            img.className = "deck-card";
            img.src = imgUrl;
            img.title = `${card.name} [${card.set}]`;
            col.appendChild(img);
        }
    }

    return col;
}

// ---------- BATCH REQUEST MANAGER (INDEX MATCHING FIX) ----------
async function preloadDeckImages(deck) {
    const allCards = [...deck.cards, ...(deck.sideboard || [])];
    
    const missingIdentifiers = [];
    const missingCardsSource = []; // Track the original card objects in order

    for (const card of allCards) {
        const key = `${card.set}|${card.name}`;
        if (!CARD_CACHE[key]) {
            missingIdentifiers.push({ name: card.name, set: card.set.toLowerCase() });
            missingCardsSource.push(card); // Keep track of this exact reference
        }
    }

    if (missingIdentifiers.length === 0) return;

    try {
        const res = await fetch("https://api.scryfall.com/cards/collection", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identifiers: missingIdentifiers })
        });
        
        const resultData = await res.json();

        if (resultData && resultData.data) {
            // Use the loop index to map directly back to the matching source object
            resultData.data.forEach((cardData, index) => {
                const originalCard = missingCardsSource[index];

                if (originalCard) {
                    const cacheKey = `${originalCard.set}|${originalCard.name}`;
                    
                    const img = cardData.image_uris?.normal || 
                                cardData.card_faces?.[0]?.image_uris?.normal;
                                
                    if (img) {
                        CARD_CACHE[cacheKey] = img;
                    }
                }
            });
        }
    } catch (e) {
        console.error("Batch lookup error:", e);
    }
}

// ---------- UPDATE: FETCH CARD IMAGE (MATCH LOWERCASE CACHE LOOKUP) ----------
async function fetchCardImage(card) {
    // Force lowercase lookup matching what was saved by the batch script
    const key = `${card.set}|${card.name}`.toLowerCase();

    if (CARD_CACHE[key]) return CARD_CACHE[key];

    return "https://via.placeholder.com/146x204?text=Missing";
}

// ---------- SCRYFALL FETCH (REDUCED TO SYNCHRONOUS CACHE DROP) ----------
async function fetchCardImage(card) {
    const key = `${card.set}|${card.name}`;

    // If the batch endpoint grabbed it, return it instantly
    if (CARD_CACHE[key]) return CARD_CACHE[key];

    // Fallback placeholder image if the collection payload didn't match
    return "https://via.placeholder.com/146x204?text=Missing";
}

// ---------- GROUPING ----------
function groupByCard(cards) {
    const map = new Map();

    for (const c of cards) {
        const key = `${c.name}|${c.set}`;

        if (!map.has(key)) {
            map.set(key, { ...c });
        } else {
            map.get(key).qty += c.qty;
        }
    }

    return Array.from(map.values());
}

// ---------- START ----------
init();