const screens = {
    start: document.getElementById("start-screen"),
    direction: document.getElementById("direction-screen"),
    study: document.getElementById("study-screen"),
    summary: document.getElementById("summary-screen"),
};

const state = {
    currentSet: null,
    allCards: [],
    roundCards: [],
    currentIndex: 0,
    direction: "pl-en",
    answers: [],
    wrongCards: [],
    flipped: false,
    startedAt: null,
    mode: "all",
};

const el = {
    fileInput: document.getElementById("file-input"),
    dropZone: document.getElementById("drop-zone"),
    uploadMessage: document.getElementById("upload-message"),
    savedSets: document.getElementById("saved-sets"),
    refreshSets: document.getElementById("refresh-sets"),

    directionSetName: document.getElementById("direction-set-name"),
    directionCardCount: document.getElementById("direction-card-count"),
    historyBox: document.getElementById("history-box"),

    correctCount: document.getElementById("correct-count"),
    incorrectCount: document.getElementById("incorrect-count"),
    remainingCount: document.getElementById("remaining-count"),
    studyDirection: document.getElementById("study-direction"),
    roundLabel: document.getElementById("round-label"),
    flashcard: document.getElementById("flashcard"),
    frontText: document.getElementById("front-text"),
    backText: document.getElementById("back-text"),
    flipHint: document.getElementById("flip-hint"),
    dontKnowButton: document.getElementById("dont-know-button"),
    knowButton: document.getElementById("know-button"),

    summaryCorrect: document.getElementById("summary-correct"),
    summaryIncorrect: document.getElementById("summary-incorrect"),
    repeatMistakes: document.getElementById("repeat-mistakes"),
    restartAll: document.getElementById("restart-all"),
    summaryMessage: document.getElementById("summary-message"),
};


function showScreen(name) {
    Object.values(screens).forEach((screen) => screen.classList.remove("active"));
    screens[name].classList.add("active");
}


function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("pl-PL", {
        dateStyle: "medium",
        timeStyle: "short",
    }).format(date);
}


function escapeHtml(text) {
    return String(text)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function shuffle(array) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}


async function api(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || "Wystąpił błąd.");
    }

    return data;
}


async function loadSets() {
    el.savedSets.innerHTML = '<div class="empty-state">Ładowanie...</div>';

    try {
        const sets = await api("/api/sets");

        if (!sets.length) {
            el.savedSets.innerHTML =
                '<div class="empty-state">Nie masz jeszcze zapisanych zestawów.</div>';
            return;
        }

        el.savedSets.innerHTML = sets.map((set) => `
            <article class="saved-set">
                <div>
                    <h3>${escapeHtml(set.name)}</h3>
                    <div class="saved-set-meta">
                        ${set.card_count} fiszek · dodano ${escapeHtml(formatDate(set.created_at))}
                        ${set.last_studied ? ` · ostatnia nauka ${escapeHtml(formatDate(set.last_studied))}` : ""}
                    </div>
                </div>
                <div class="saved-set-actions">
                    <button class="primary-button" data-open-set="${set.id}" type="button">
                        Ucz się
                    </button>
                    <button class="ghost-button danger-button" data-delete-set="${set.id}" type="button">
                        Usuń
                    </button>
                </div>
            </article>
        `).join("");
    } catch (error) {
        el.savedSets.innerHTML =
            `<div class="empty-state">Nie udało się pobrać zestawów: ${escapeHtml(error.message)}</div>`;
    }
}


async function handleUpload(file) {
    if (!file) return;

    el.uploadMessage.className = "message";
    el.uploadMessage.textContent = "Wczytywanie pliku...";

    const form = new FormData();
    form.append("file", file);

    try {
        const result = await api("/api/upload", {
            method: "POST",
            body: form,
        });

        el.uploadMessage.className = "message success";
        el.uploadMessage.textContent =
            `Dodano ${result.card_count} fiszek z pliku „${result.name}”.`;

        await loadSets();
        await openSet(result.set_id);
    } catch (error) {
        el.uploadMessage.className = "message error";
        el.uploadMessage.textContent = error.message;
    } finally {
        el.fileInput.value = "";
    }
}


async function openSet(setId) {
    try {
        const data = await api(`/api/sets/${setId}`);
        state.currentSet = data.set;
        state.allCards = data.cards;

        el.directionSetName.textContent = data.set.name;
        el.directionCardCount.textContent = `${data.cards.length} fiszek`;
        await loadHistory(setId);

        showScreen("direction");
    } catch (error) {
        alert(error.message);
    }
}


async function loadHistory(setId) {
    try {
        const history = await api(`/api/history/${setId}`);

        if (!history.length) {
            el.historyBox.innerHTML =
                '<p class="muted">Brak zapisanych sesji dla tego zestawu.</p>';
            return;
        }

        const items = history.slice(0, 6).map((item) => {
            const dir = item.direction === "pl-en" ? "PL → EN" : "EN → PL";
            const mode = item.mode === "mistakes" ? "błędne" : "całość";
            return `
                <div class="history-item">
                    <span>${escapeHtml(formatDate(item.finished_at))} · ${dir} · ${mode}</span>
                    <strong>${item.correct}/${item.total}</strong>
                </div>
            `;
        }).join("");

        el.historyBox.innerHTML = `
            <p class="eyebrow">OSTATNIE SESJE</p>
            <div class="history-list">${items}</div>
        `;
    } catch {
        el.historyBox.innerHTML =
            '<p class="muted">Nie udało się pobrać historii.</p>';
    }
}


function startRound(cards, mode = "all") {
    state.roundCards = shuffle(cards);
    state.currentIndex = 0;
    state.answers = [];
    state.wrongCards = [];
    state.startedAt = new Date().toISOString();
    state.mode = mode;
    state.flipped = false;

    el.studyDirection.textContent =
        state.direction === "pl-en" ? "PL → EN" : "EN → PL";
    el.roundLabel.textContent =
        mode === "mistakes" ? "POWTÓRKA BŁĘDNYCH" : "PEŁNY ZESTAW";

    updateCounters();
    renderCard();
    showScreen("study");
}


function renderCard() {
    const card = state.roundCards[state.currentIndex];
    if (!card) {
        finishRound();
        return;
    }

    state.flipped = false;
    el.flashcard.classList.remove("flipped");
    el.dontKnowButton.disabled = true;
    el.knowButton.disabled = true;
    el.flipHint.textContent = "Kliknij fiszkę, aby zobaczyć odpowiedź";

    if (state.direction === "pl-en") {
        el.frontText.textContent = card.polish;
        el.backText.textContent = card.english;
    } else {
        el.frontText.textContent = card.english;
        el.backText.textContent = card.polish;
    }

    updateCounters();
}


function flipCard() {
    if (!state.roundCards[state.currentIndex]) return;

    state.flipped = !state.flipped;
    el.flashcard.classList.toggle("flipped", state.flipped);

    if (state.flipped) {
        el.dontKnowButton.disabled = false;
        el.knowButton.disabled = false;
        el.flipHint.textContent = "Oceń, czy znałeś odpowiedź";
    } else {
        el.dontKnowButton.disabled = true;
        el.knowButton.disabled = true;
        el.flipHint.textContent = "Kliknij fiszkę, aby zobaczyć odpowiedź";
    }
}


function updateCounters() {
    const correct = state.answers.filter((answer) => answer.is_correct).length;
    const incorrect = state.answers.length - correct;
    const remaining = Math.max(state.roundCards.length - state.answers.length, 0);

    el.correctCount.textContent = correct;
    el.incorrectCount.textContent = incorrect;
    el.remainingCount.textContent = remaining;
}


function answerCurrent(isCorrect) {
    if (!state.flipped) return;

    const card = state.roundCards[state.currentIndex];
    if (!card) return;

    state.answers.push({
        card_id: card.id,
        is_correct: isCorrect,
    });

    if (!isCorrect) {
        state.wrongCards.push(card);
    }

    state.currentIndex += 1;
    renderCard();
}


async function finishRound() {
    const correct = state.answers.filter((answer) => answer.is_correct).length;
    const incorrect = state.answers.length - correct;

    el.summaryCorrect.textContent = correct;
    el.summaryIncorrect.textContent = incorrect;
    el.repeatMistakes.disabled = incorrect === 0;
    el.summaryMessage.textContent =
        incorrect === 0
            ? "Świetnie — w tej rundzie nie było błędnych odpowiedzi."
            : "Możesz teraz powtórzyć tylko błędne fiszki albo zacząć cały zestaw od początku.";

    showScreen("summary");

    try {
        await api("/api/sessions", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                set_id: state.currentSet.id,
                direction: state.direction,
                mode: state.mode,
                started_at: state.startedAt,
                answers: state.answers,
            }),
        });
    } catch (error) {
        el.summaryMessage.textContent += ` Nie udało się zapisać sesji: ${error.message}`;
    }
}


async function deleteSet(setId) {
    const confirmed = window.confirm(
        "Usunąć ten zestaw wraz z jego historią? Tej operacji nie można cofnąć."
    );
    if (!confirmed) return;

    try {
        await api(`/api/sets/${setId}`, {method: "DELETE"});
        await loadSets();
    } catch (error) {
        alert(error.message);
    }
}


el.fileInput.addEventListener("change", (event) => {
    handleUpload(event.target.files[0]);
});

["dragenter", "dragover"].forEach((eventName) => {
    el.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        el.dropZone.classList.add("dragover");
    });
});

["dragleave", "drop"].forEach((eventName) => {
    el.dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        el.dropZone.classList.remove("dragover");
    });
});

el.dropZone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    handleUpload(file);
});

el.refreshSets.addEventListener("click", loadSets);

el.savedSets.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-open-set]");
    const deleteButton = event.target.closest("[data-delete-set]");

    if (openButton) {
        openSet(Number(openButton.dataset.openSet));
    }

    if (deleteButton) {
        deleteSet(Number(deleteButton.dataset.deleteSet));
    }
});

document.querySelectorAll("[data-direction]").forEach((button) => {
    button.addEventListener("click", () => {
        state.direction = button.dataset.direction;
        startRound(state.allCards, "all");
    });
});

document.querySelectorAll("[data-action='back-start']").forEach((button) => {
    button.addEventListener("click", () => {
        loadSets();
        showScreen("start");
    });
});

document.querySelectorAll("[data-action='quit-study']").forEach((button) => {
    button.addEventListener("click", () => {
        const confirmed = window.confirm("Przerwać obecną rundę?");
        if (!confirmed) return;
        loadSets();
        showScreen("start");
    });
});

document.querySelectorAll("[data-action='back-direction']").forEach((button) => {
    button.addEventListener("click", async () => {
        await loadHistory(state.currentSet.id);
        showScreen("direction");
    });
});

el.flashcard.addEventListener("click", flipCard);
el.dontKnowButton.addEventListener("click", () => answerCurrent(false));
el.knowButton.addEventListener("click", () => answerCurrent(true));

el.repeatMistakes.addEventListener("click", () => {
    if (state.wrongCards.length) {
        startRound(state.wrongCards, "mistakes");
    }
});

el.restartAll.addEventListener("click", () => {
    startRound(state.allCards, "all");
});

document.addEventListener("keydown", (event) => {
    if (!screens.study.classList.contains("active")) return;

    if (event.code === "Space") {
        event.preventDefault();
        flipCard();
        return;
    }

    if (!state.flipped) return;

    if (event.key === "ArrowLeft") {
        answerCurrent(false);
    } else if (event.key === "ArrowRight") {
        answerCurrent(true);
    }
});

loadSets();
