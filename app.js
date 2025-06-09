// --- Global State ---
let nostrRelay; // Will be initialized in connectToRelaysAndSync

let state = {
    thoughts: {}, // Store notes, DMs, group messages
    profiles: {}, // Store user profiles
    currentUser: { // Placeholder for current user data
        sk: null, // User's secret key
        pk: null  // User's public key
    },
    currentOpenThoughtId: null, // ID of the currently open/edited thought
    settings: {
        theme: 'light', // Default theme
        lm: { // Language model settings
            enabled: false,
            url: null
        }
    }
};

// --- Nostr Stubs ---
// These will be replaced with actual nostr-tools functions
const nip04 = {
    encrypt: async (sk, pk, text) => {
        console.log(`[STUB] Encrypting text for pk ${pk}: ${text.substring(0, 50)}...`);
        return `encrypted:${text}`;
    },
    decrypt: async (sk, pk, payload) => {
        console.log(`[STUB] Decrypting payload for pk ${pk}: ${payload.substring(0,50)}...`);
        if (payload.startsWith('encrypted:')) {
            return payload.substring('encrypted:'.length);
        }
        return payload;
    }
};

const nostr = {
    generateSecretKey: () => {
        console.log("[STUB] Generating secret key");
        return new Uint8Array(32).fill(1);
    },
    getPublicKey: (sk) => {
        console.log("[STUB] Getting public key from secret key");
        return 'dummy-public-key-' + Array.from(sk).slice(0,4).join('');
    },
    relayInit: (relayUrl) => {
        console.log(`[STUB] Initializing relay: ${relayUrl}`);
        return {
            connect: async () => console.log('[STUB] Relay connect'),
            publish: async (event) => {
                console.log('[STUB] Publishing event:', event);
                return { id: 'dummy-event-id-' + Date.now(), on: () => {} };
            },
            subscribe: (filters) => {
                console.log('[STUB] Subscribing with filters:', filters);
                return {
                    on: (type, callback) => {
                        if (type === 'event') {
                            console.log('[STUB] Simulating event reception for sync');
                        }
                    },
                    unsub: () => console.log('[STUB] Unsubscribe'),
                };
            },
            on: (eventType, callback) => console.log(`[STUB] Relay on ${eventType}`),
            off: (eventType, callback) => console.log(`[STUB] Relay off ${eventType}`),
            close: () => console.log('[STUB] Relay close'),
        };
    }
};

// --- Initialization ---
async function initializeApp() {
    // 0. Load user keys
    let sk = await localforage.getItem('currentUserSK');
    if (!sk) {
        sk = nostr.generateSecretKey();
        await localforage.setItem('currentUserSK', sk);
        console.log("Generated and saved new secret key.");
    } else {
        if (!(sk instanceof Uint8Array)) {
            sk = new Uint8Array(Object.values(sk));
        }
        console.log("Loaded secret key from localforage.");
    }
    state.currentUser.sk = sk;
    state.currentUser.pk = nostr.getPublicKey(sk);
    console.log("Current user PK:", state.currentUser.pk);

    // 1. Load theme
    const savedTheme = await localforage.getItem('theme');
    if (savedTheme) {
        state.settings.theme = savedTheme;
        document.documentElement.dataset.theme = savedTheme;
    }
    console.log(`Theme set to: ${state.settings.theme}`);
    document.getElementById('theme-switcher').addEventListener('click', toggleThemeAndSave);

    // 2. Load thoughts and profiles
    const localThoughts = await localforage.getItem('thoughts_v3');
    if (localThoughts) {
        state.thoughts = localThoughts;
        console.log("Loaded thoughts from localforage:", state.thoughts);
    }
    const localProfiles = await localforage.getItem('profiles');
    if (localProfiles) {
        state.profiles = localProfiles;
        console.log("Loaded profiles from localforage:", state.profiles);
    }

    // 3. Initial UI Render
    renderNotesList();
    document.getElementById('new-note-button').addEventListener('click', createNewNote);

    // 4. Connect to Nostr relays and subscribe for sync
    await connectToRelaysAndSync();

    // 5. Restore last open thought or select first one
    const lastOpenId = await localforage.getItem('lastOpenThoughtId');
    if (lastOpenId && state.thoughts[lastOpenId]) {
        selectThought(lastOpenId);
    } else if (Object.keys(state.thoughts).length > 0) {
        const firstNoteId = Object.values(state.thoughts).find(t => t.type === 'note')?.id;
        if (firstNoteId) selectThought(firstNoteId);
        else {
            document.getElementById('main-content').innerHTML = '<p>Select a note to edit or create a new one.</p>';
        }
    } else {
         document.getElementById('main-content').innerHTML = '<p>Select a note to edit or create a new one.</p>';
    }

    console.log("App initialized. Current state snapshot:", JSON.parse(JSON.stringify(state)));
}

// --- Theme Management ---
async function toggleThemeAndSave() {
    const newTheme = state.settings.theme === 'light' ? 'dark' : 'light';
    state.settings.theme = newTheme;
    document.documentElement.dataset.theme = newTheme;
    await localforage.setItem('theme', newTheme);
    console.log(`Theme changed to ${newTheme} and saved.`);
}

// --- UI Rendering and Interaction ---

function renderNoteListItemHTML(thought) {
    return `<li><a href="#" data-id="${thought.id}">${thought.title || 'Untitled Note'}</a></li>`;
}

function renderNotesList() {
    const notesListElement = document.getElementById('notes-list');
    if (!notesListElement) return;

    notesListElement.innerHTML = '';

    const sortedNotes = Object.values(state.thoughts)
        .filter(thought => thought && thought.type === 'note') // Add null check for thought
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    sortedNotes.forEach(thought => {
        const listItemHTML = renderNoteListItemHTML(thought);
        notesListElement.insertAdjacentHTML('beforeend', listItemHTML);
        const linkElement = notesListElement.lastElementChild?.querySelector('a');

        if (linkElement) {
            linkElement.addEventListener('click', (event) => {
                event.preventDefault();
                selectThought(thought.id);
            });
        }
    });
    if (state.currentOpenThoughtId) {
        const activeLink = notesListElement.querySelector(`a[data-id="${state.currentOpenThoughtId}"]`);
        if (activeLink) activeLink.classList.add('active');
    }
}

function renderTags(thought) {
    const tagsDisplay = document.getElementById('tags-display');
    if (!tagsDisplay) return;
    tagsDisplay.innerHTML = '';

    (thought.tags || []).forEach(tag => {
        const tagElement = document.createElement('span');
        tagElement.classList.add('tag');
        tagElement.textContent = tag;

        const removeButton = document.createElement('button');
        removeButton.classList.add('remove-tag');
        removeButton.textContent = 'x';
        removeButton.type = "button"; // Important for forms
        removeButton.addEventListener('click', () => {
            state.thoughts[thought.id].tags = state.thoughts[thought.id].tags.filter(t => t !== tag);
            state.thoughts[thought.id].timestamp = Date.now();
            onStateChange();
            renderTags(thought);
        });

        tagElement.appendChild(removeButton);
        tagsDisplay.appendChild(tagElement);
    });
}

function renderNoteEditorView(thought) {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    mainContent.innerHTML = `
        <div class="note-editor" data-id="${thought.id}">
            <h1><input type="text" id="note-title-input" value="${thought.title || ''}" placeholder="Note Title"></h1>
            <div class="tags-container">
                Tags: <span id="tags-display"></span>
                <input type="text" id="tag-input" placeholder="Add a tag (e.g., work)">
                <button type="button" id="add-tag-button">Add Tag</button>
            </div>
            <textarea id="note-body-textarea" placeholder="Your note...">${thought.body || ''}</textarea>
        </div>
    `;

    renderTags(thought);

    const titleInput = document.getElementById('note-title-input');
    const bodyTextarea = document.getElementById('note-body-textarea');
    const tagInput = document.getElementById('tag-input');
    const addTagButton = document.getElementById('add-tag-button');

    // Auto-expansion for textarea
    const autoExpandTextarea = (textarea) => {
        if (textarea) {
            textarea.style.height = 'auto'; // Temporarily shrink to get correct scrollHeight
            textarea.style.height = textarea.scrollHeight + 'px';
        }
    };

    // Set initial height for textarea after content is loaded
    if (bodyTextarea) {
        autoExpandTextarea(bodyTextarea);
    }

    titleInput.addEventListener('input', debounce(() => {
        state.thoughts[thought.id].title = titleInput.value;
        state.thoughts[thought.id].timestamp = Date.now();
        onStateChange();
        const sidebarLink = document.querySelector(`#notes-list a[data-id="${thought.id}"]`);
        if (sidebarLink) {
            sidebarLink.textContent = titleInput.value || 'Untitled Note';
        }
    }, 300)); // Debounce title input slightly

    bodyTextarea.addEventListener('input', debounce(() => {
        state.thoughts[thought.id].body = bodyTextarea.value;
        state.thoughts[thought.id].timestamp = Date.now();
        onStateChange();
        autoExpandTextarea(bodyTextarea); // Auto-expand on input
    }, 500)); // Debounce body input more

    const addTagAction = () => {
        const newTag = tagInput.value.trim().toLowerCase();
        if (newTag) {
            if (!state.thoughts[thought.id].tags) state.thoughts[thought.id].tags = [];
            if (!state.thoughts[thought.id].tags.includes(newTag)) {
                state.thoughts[thought.id].tags.push(newTag);
                state.thoughts[thought.id].timestamp = Date.now();
                onStateChange();
                renderTags(thought);
                tagInput.value = '';
            }
        }
    };

    addTagButton.addEventListener('click', addTagAction);
    tagInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTagAction();
        }
    });
}

async function selectThought(thoughtId) {
    const thought = state.thoughts[thoughtId];
    if (thought) {
        state.currentOpenThoughtId = thoughtId;
        await localforage.setItem('lastOpenThoughtId', thoughtId);

        document.querySelectorAll('#notes-list a').forEach(a => a.classList.remove('active'));
        const activeLink = document.querySelector(`#notes-list a[data-id="${thoughtId}"]`);
        if (activeLink) activeLink.classList.add('active');

        if (thought.type === 'note') {
            renderNoteEditorView(thought);
        } else {
            const mainContent = document.getElementById('main-content');
            mainContent.innerHTML = `<p>Selected: ${thought.title || thought.id} (Type: ${thought.type}) - Editor not implemented.</p>`;
        }
        console.log(`Selected thought: ${thoughtId}`);
    } else {
        console.warn(`Thought ID ${thoughtId} not found for selection.`);
        document.getElementById('main-content').innerHTML = `<p>Select a note to edit or create a new one.</p>`;
        state.currentOpenThoughtId = null;
        await localforage.removeItem('lastOpenThoughtId');
        renderNotesList(); // Ensure sidebar active state is cleared
    }
}

function createNewNote() {
    const newId = `note-${Date.now()}`;
    const newNote = {
        id: newId,
        type: 'note',
        title: 'Untitled Note',
        body: '',
        tags: [],
        timestamp: Date.now(),
        created_at: Math.floor(Date.now() / 1000)
    };
    state.thoughts[newId] = newNote;
    onStateChange();
    renderNotesList();
    selectThought(newId);

    const titleInput = document.getElementById('note-title-input');
    if(titleInput) {
        titleInput.focus();
        titleInput.select(); // Select the default title for easy editing
    }
}

// --- Synchronization Logic ---
async function syncState() {
    console.log("[Sync] Attempting to sync state to Nostr...");
    if (!state.currentUser.sk || !state.currentUser.pk || !nostrRelay) {
        console.error("[Sync] User keys or relay not initialized. Aborting sync.");
        return;
    }

    try {
        const thoughtsToSync = {};
        for (const key in state.thoughts) {
            if (state.thoughts[key]) { // Ensure no null/undefined thoughts are synced
                thoughtsToSync[key] = state.thoughts[key];
            }
        }
        const payloadObject = {
            thoughts: thoughtsToSync,
            profiles: state.profiles,
            timestamp: Date.now()
        };
        const payloadString = JSON.stringify(payloadObject);
        console.log("[Sync] Payload to encrypt:", payloadString.substring(0, 100) + "...");

        const encryptedPayload = await nip04.encrypt(state.currentUser.sk, state.currentUser.pk, payloadString);
        console.log("[Sync] Encrypted payload:", encryptedPayload.substring(0, 50) + "...");

        const event = {
            kind: 4,
            pubkey: state.currentUser.pk,
            tags: [['p', state.currentUser.pk]],
            content: encryptedPayload,
            created_at: Math.floor(Date.now() / 1000)
        };

        console.log("[Sync] Publishing event:", event);
        const pub = await nostrRelay.publish(event);
        console.log("[Sync] State published successfully. Event ID (stubbed):", pub.id);

    } catch (error) {
        console.error("[Sync] Error syncing state:", error);
    }
}

const debouncedSync = debounce(syncState, 2000);

function onStateChange() {
    console.log("[StateChange] Detected. Debouncing syncState call.");
    debouncedSync();
}

async function connectToRelaysAndSync() {
    if (!state.currentUser.pk) {
        console.error("[Relay] Cannot connect, no current user PK.");
        return;
    }
    console.log("[Relay] Initializing and connecting to relays...");
    nostrRelay = nostr.relayInit('wss://nos.lol');

    nostrRelay.on('connect', () => console.log(`[Relay] Connected to ${nostrRelay.url}`));
    nostrRelay.on('error', (err) => console.error(`[Relay] Error with ${nostrRelay.url}:`, err));
    nostrRelay.on('disconnect', () => console.log(`[Relay] Disconnected from ${nostrRelay.url}`));
    nostrRelay.on('notice', (notice) => console.warn(`[Relay] Notice from ${nostrRelay.url}: ${notice}`));

    try {
        await nostrRelay.connect();
    } catch (error) {
        console.error(`[Relay] Failed to connect to ${nostrRelay.url}:`, error);
        return;
    }

    const filters = [{
        kinds: [4],
        authors: [state.currentUser.pk],
        '#p': [state.currentUser.pk],
        limit: 20 // Increased limit slightly
    }];

    console.log("[Relay] Subscribing to events with filters:", JSON.stringify(filters));
    const sub = nostrRelay.subscribe(filters);

    sub.on('event', async (event) => {
        console.log('[Relay] Received event:', JSON.parse(JSON.stringify(event))); // Log a copy
        try {
            const decryptedPayload = await nip04.decrypt(state.currentUser.sk, state.currentUser.pk, event.content);
            console.log('[Relay] Decrypted payload:', decryptedPayload.substring(0,100) + "...");

            const remoteState = JSON.parse(decryptedPayload);
            console.log('[Relay] Parsed remote state object. Timestamp:', remoteState.timestamp);

            let changesMade = false;
            let openThoughtUpdatedByRemote = false;

            if (remoteState.thoughts) {
                for (const thoughtId in remoteState.thoughts) {
                    const remoteThought = remoteState.thoughts[thoughtId];
                    if (!remoteThought) continue; // Skip if remote thought is null/undefined

                    const localThought = state.thoughts[thoughtId];

                    if (!localThought || (remoteThought.timestamp || 0) > (localThought.timestamp || 0)) {
                        console.log(`[Merge] Updating thought ${thoughtId}. Remote ts: ${remoteThought.timestamp}, Local ts: ${localThought?.timestamp}`);
                        state.thoughts[thoughtId] = remoteThought;
                        changesMade = true;
                        if (thoughtId === state.currentOpenThoughtId) {
                            openThoughtUpdatedByRemote = true;
                        }
                    }
                }
            }

            if (remoteState.profiles && (remoteState.timestamp > (state.profiles?.timestamp || 0))) {
                 console.log(`[Merge] Updating profiles. Remote ts: ${remoteState.timestamp}, Local ts: ${state.profiles?.timestamp}`);
                state.profiles = remoteState.profiles;
                changesMade = true;
            }

            if (changesMade) {
                console.log("[Merge] Changes applied from remote.");
                await localforage.setItem('thoughts_v3', state.thoughts);
                await localforage.setItem('profiles', state.profiles);
                console.log("[Merge] Updated state saved to localforage.");

                renderNotesList(); // Always re-render notes list if any change

                if (openThoughtUpdatedByRemote) {
                    console.log("[Merge] Currently open thought was updated by remote. Re-rendering editor view.");
                    const updatedThought = state.thoughts[state.currentOpenThoughtId];
                    if (updatedThought?.type === 'note') {
                        renderNoteEditorView(updatedThought);
                    }
                } else if (state.currentOpenThoughtId && !state.thoughts[state.currentOpenThoughtId]) {
                    // If current open thought was deleted by a remote merge (e.g. another client deleted it)
                    console.log(`[Merge] Current open thought ${state.currentOpenThoughtId} no longer exists. Clearing view.`);
                    selectThought(null); // This will clear the view
                }
            } else {
                console.log("[Merge] No changes needed based on incoming event timestamps.");
            }

        } catch (error) {
            console.error('[Relay] Error processing incoming event:', error, 'Event content:', event.content);
        }
    });

    sub.on('eose', () => {
        console.log('[Relay] End of stored events (EOSE) received for initial subscription.');
    });

    console.log("[Relay] Attempting initial sync of local state after connection.");
    await syncState();
}

// --- Utility functions ---
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}

// --- Start the app ---
document.addEventListener('DOMContentLoaded', initializeApp);
