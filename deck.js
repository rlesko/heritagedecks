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

// ---------- LOAD DECK FILE ----------
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

// ---------- PARSE DECK TEXT ----------
// ---------- PARSE DECK TEXT (FIXED FOR NUMERIC SET CODES) ----------
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

        // THE FIX: Replaced lazy matching (.+?) with a strict non-bracket match ([^\[]+)
        // This isolates the card name cleanly up to the "[" marker, completely ignoring digits inside the set tags.
        const match = line.match(/^(\d+)\s+([^\[]+)\s+\[([A-Za-z0-9]+)\]$/i);

        if (!match) {
            console.warn("Regex failed to parse line:", line);
            continue;
        }

        const qty = parseInt(match[1], 10);
        const name = match[2].trim();
        const set = match[3].toLowerCase(); // Normalized to lowercase for cache synchronization

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
            img.title = `${card.name} [${card.set.toUpperCase()}]`;
            
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
        const sbHeader = document.createElement("h3");
        sbHeader.textContent = "Sideboard";
        sbHeader.style.margin = "40px 0 20px 0";
        container.appendChild(sbHeader);

        const sbWrapper = document.createElement("div");
        sbWrapper.className = "deck-columns";

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
                if (sbColCardCount >= SB_MAX_PER_COL) {
                    sbColIdx++;
                    sbColCardCount = 0;
                }

                const colIndex = sbColIdx < SB_COLS ? sbColIdx : SB_COLS - 1;
                const targetColumn = sbColumns[colIndex];

                const img = document.createElement("img");
                img.className = "deck-card";
                img.src = imgUrl;
                img.title = `${card.name} [${card.set.toUpperCase()}] (SB)`;
                
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

// ---------- BATCH REQUEST MANAGER (EXPLICIT PROPERTY MATCHING) ----------
async function preloadDeckImages(deck) {
    const allCards = [...deck.cards, ...(deck.sideboard || [])];
    
    const missingIdentifiers = [];
    for (const card of allCards) {
        const key = `${card.set}|${card.name}`.toLowerCase();
        if (!CARD_CACHE[key]) {
            // Force set uppercase for Scryfall collection API compatibility
            missingIdentifiers.push({ name: card.name, set: card.set.toUpperCase() });
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
            // FIX: We loop through Scryfall's data independently of input array order
            resultData.data.forEach((cardData) => {
                if (!cardData || cardData.status) return;

                // Extract the clean front-face name (e.g., "Delver of Secrets // Insectile Aberration" -> "Delver of Secrets")
                const scryfallName = cardData.name || "";
                const cleanName = scryfallName.split("//")[0].trim().toLowerCase();
                const set = (cardData.set || "").toLowerCase();

                // FIX: Look into card_faces if top-level image_uris are missing (for Delver & Liberator)
                const img = cardData.image_uris?.normal || 
                            cardData.card_faces?.[0]?.image_uris?.normal;

                if (img) {
                    // Find the original matching entry from our deck object to grab its exact text file casing
                    const originalCard = allCards.find(c => 
                        c.set.toLowerCase() === set && 
                        c.name.toLowerCase() === cleanName
                    );

                    if (originalCard) {
                        // Store it using the exact case-mapping expected by your fetchCardImage function
                        const cacheKey = `${originalCard.set}|${originalCard.name}`.toLowerCase();
                        CARD_CACHE[cacheKey] = img;
                    }
                }
            });
        }
    } catch (e) {
        console.error("Batch lookup error:", e);
    }
}

// ---------- CARD IMAGE SERVICE LAYER ----------
async function fetchCardImage(card) {
    const key = `${card.set}|${card.name}`.toLowerCase();

    if (CARD_CACHE[key]) return CARD_CACHE[key];

    // Clean placeholder card back link when API keys mismatch or break
    return "https://cards.scryfall.io/large/front/5/7/575e3f83-314c-4d1a-9597-4aed2f86e475.jpg";
}

// ---------- GROUPING ----------
function groupByCard(cards) {
    const map = new Map();

    for (const c of cards) {
        const key = `${c.name}|${c.set}`.toLowerCase();

        if (!map.has(key)) {
            map.set(key, { ...c });
        } else {
            map.get(key).qty += c.qty;
        }
    }

    return Array.from(map.values());
}

init();