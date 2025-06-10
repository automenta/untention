// @ts-check
import { test, expect } from '@playwright/test';

// Base URL is set in playwright.config.js, so paths are relative to that.
const PAGE_URL = '/index.html';

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE_URL);
});

test('homepage has Notention title and app shell', async ({ page }) => {
  await expect(page).toHaveTitle(/Notention/);
  await expect(page.locator('#app-shell')).toBeVisible();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#main-view')).toBeVisible();
});

test.describe('Identity Management', () => {
  test('should create a new identity and then log out', async ({ page }) => {
    // Click the "Load/Create" button in IdentityPanel
    await page.locator('#identity-panel button:has-text("Load/Create")').click();

    // Modal appears, leave private key blank and click "Load/Gen"
    await expect(page.locator('.modal-content h3:has-text("Manage Identity")')).toBeVisible();
    await page.locator('.modal-content button:has-text("Load/Gen")').click();

    // Verify success toast
    await expect(page.locator('.toast:has-text("Identity loaded!")')).toBeVisible();

    // Verify UI updates in IdentityPanel (avatar, name, pubkey)
    await expect(page.locator('#identity-panel .avatar')).toHaveAttribute('src', /data:image\/svg\+xml/);
    const userNameText = await page.locator('#identity-panel .user-name').textContent();
    expect(userNameText).toMatch(/^npub1.{4}\.\.\..{4}$/); // Default shortened pubkey format or a name
    const pubkeyText = await page.locator('#identity-panel .pubkey').textContent();
    expect(pubkeyText).toMatch(/^npub1.{58}$/); // Full npub

    // Verify "Logout" button is now visible
    const logoutButton = page.locator('#identity-panel button:has-text("Logout")');
    await expect(logoutButton).toBeVisible();

    // Test logging out
    await logoutButton.click();
    // Handle confirm dialog
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#identity-panel button:has-text("Logout")').click(); // Re-click might be needed if dialog listener setup is slow


    // Verify logout toast
    await expect(page.locator('.toast:has-text("Logged out.")')).toBeVisible();

    // Verify IdentityPanel reverts to "Load/Create"
    await expect(page.locator('#identity-panel button:has-text("Load/Create")')).toBeVisible();
    await expect(page.locator('#identity-panel .user-name').textContent()).toBe('Anonymous');
    await expect(page.locator('#identity-panel .pubkey').textContent()).toBe('No identity loaded');
  });
});

test.describe('Profile Update', () => {
  test.beforeEach(async ({ page }) => {
    // Create a new identity first
    await page.locator('#identity-panel button:has-text("Load/Create")').click();
    await page.locator('.modal-content button:has-text("Load/Gen")').click();
    await expect(page.locator('.toast:has-text("Identity loaded!")')).toBeVisible();
     // Wait for toast to disappear to prevent interference
    await page.waitForSelector('.toast:has-text("Identity loaded!")', { state: 'hidden' });
  });

  test('should update profile name', async ({ page }) => {
    await page.locator('#identity-panel button:has-text("Profile")').click();

    // Modal appears
    await expect(page.locator('.modal-content h3:has-text("Edit Profile")')).toBeVisible();

    // Update name
    const newName = 'Test User E2E';
    await page.locator('.modal-content input[name="name"]').fill(newName);
    await page.locator('.modal-content button:has-text("Save")').click();

    // Verify success toast
    await expect(page.locator('.toast:has-text("Profile updated!")')).toBeVisible();

    // Verify IdentityPanel updates with the new name
    await expect(page.locator('#identity-panel .user-name')).toHaveText(newName);
  });
});

test.describe('Relay Management', () => {
  test('should add, remove, and handle invalid relays', async ({ page }) => {
    await page.locator('#identity-panel button:has-text("Relays")').click();

    // Modal appears
    await expect(page.locator('.modal-content h3:has-text("Manage Relays")')).toBeVisible();

    // Add a valid relay
    const validRelay = 'wss://relay.example.com';
    await page.locator('.modal-content input[name="url"]').fill(validRelay);
    await page.locator('.modal-content button:has-text("Add")').click();
    await expect(page.locator(`.modal-content ul li span:has-text("${validRelay}")`)).toBeVisible();
    await expect(page.locator('.toast:has-text("Relay list updated. Reconnecting...")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Relay list updated. Reconnecting...")', { state: 'hidden' });


    // Remove the relay
    await page.locator(`.modal-content ul li:has-text("${validRelay}") button:has-text("Remove")`).click();
    await expect(page.locator(`.modal-content ul li span:has-text("${validRelay}")`)).not.toBeVisible();
    await expect(page.locator('.toast:has-text("Relay list updated. Reconnecting...")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Relay list updated. Reconnecting...")', { state: 'hidden' });

    // Attempt to add an invalid relay
    const invalidRelay = 'ws://invalid-relay';
    await page.locator('.modal-content input[name="url"]').fill(invalidRelay);
    await page.locator('.modal-content button:has-text("Add")').click();
    // Assuming the add button might trigger a toast for invalid URLs directly or after a failed connection attempt.
    // For this test, we'll check that it doesn't get added to the list and a general error toast might appear.
    // The current implementation of updateRelays filters silently if not wss.
    // A more robust test would check for a specific error toast if the validation logic were to provide one.
    // For now, we check that the invalid relay is not added and the valid relay list is what we expect (e.g. default ones).
    await expect(page.locator(`.modal-content ul li span:has-text("${invalidRelay}")`)).not.toBeVisible();
    // Let's check if an error toast for "No valid relays provided" appears if we remove all default ones first.
    // This part is tricky as the default list is quite long.
    // For now, we'll just ensure the invalid one is not there.

    // Close modal
    await page.locator('.modal-content button:has-text("Close")').click();
  });
});


test.describe('Note Creation and Selection', () => {
  test.beforeEach(async ({ page }) => {
    // Create a new identity first
    await page.locator('#identity-panel button:has-text("Load/Create")').click();
    await page.locator('.modal-content button:has-text("Load/Gen")').click();
    await expect(page.locator('.toast:has-text("Identity loaded!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Identity loaded!")', { state: 'hidden' });
  });

  test('should create, edit, and re-select a note', async ({ page }) => {
    await page.locator('#identity-panel button:has-text("New Note")').click();

    // Verify success toast for note creation
    await expect(page.locator('.toast:has-text("Note created.")')).toBeVisible();

    // Verify new note "New Note" appears in thought list and is active
    const newNoteInList = page.locator('#thoughts-list .thought-item.active .thought-name span:has-text("New Note")');
    await expect(newNoteInList).toBeVisible();

    // Verify main view shows note editor
    await expect(page.locator('#note-editor-container')).toBeVisible();
    const noteTitleInput = page.locator('#note-title-input');
    const noteBodyTextarea = page.locator('#note-body-textarea');
    await expect(noteTitleInput).toHaveValue('New Note');

    // Type a title and content
    const testTitle = 'My Test Note Title';
    const testBody = 'This is the body of my test note.';
    await noteTitleInput.fill(testTitle);
    await noteBodyTextarea.fill(testBody);

    // Select Public Feed
    await page.locator('#thoughts-list .thought-item .thought-name span:has-text("Public Feed")').click();
    await expect(page.locator('#note-editor-container')).not.toBeVisible(); // Editor should hide

    // Re-select the note (it should now have the new title)
    await page.locator(`#thoughts-list .thought-item .thought-name span:has-text("${testTitle}")`).click();
    await expect(page.locator('#note-editor-container')).toBeVisible();

    // Verify title and content persist
    await expect(noteTitleInput).toHaveValue(testTitle);
    await expect(noteBodyTextarea).toHaveValue(testBody);
  });
});

test.describe('Sending a Message (Public Feed)', () => {
  test.beforeEach(async ({ page }) => {
    // Create a new identity first
    await page.locator('#identity-panel button:has-text("Load/Create")').click();
    await page.locator('.modal-content button:has-text("Load/Gen")').click();
    await expect(page.locator('.toast:has-text("Identity loaded!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Identity loaded!")', { state: 'hidden' });
  });

  test('should send a message to Public Feed', async ({ page }) => {
    // Select Public Feed (should be selected by default after login if no other thought was active)
    // Ensure it's selected for robustness
    await page.locator('#thoughts-list .thought-item .thought-name span:has-text("Public Feed")').click();
    await expect(page.locator('#thoughts-list .thought-item.active .thought-name span:has-text("Public Feed")')).toBeVisible();


    // Type a message and send
    const messageText = 'Hello, world! This is an E2E test message.';
    await page.locator('#message-input').fill(messageText);
    await page.locator('#message-input-form button:has-text("Send")').click();

    // Verify success toast
    await expect(page.locator('.toast:has-text("Message sent!")')).toBeVisible();

    // Verify the message appears in the message list
    // The sender name will be "You"
    const sentMessage = page.locator('#message-list .message.self .message-text');
    await expect(sentMessage).toHaveText(messageText);
    await expect(page.locator('#message-list .message.self .message-sender:has-text("You")')).toBeVisible();
  });
});

test.describe('Joining an Existing Group', () => {
  const sourceGroupName = 'Source Group For Joining';
  const joinedGroupName = 'Joined Test Group E2E';

  test.beforeEach(async ({ page }) => {
    // Create a new identity first
    await page.locator('#identity-panel button:has-text("Load/Create")').click();
    await page.locator('.modal-content button:has-text("Load/Gen")').click();
    await expect(page.locator('.toast:has-text("Identity loaded!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Identity loaded!")', { state: 'hidden' });
  });

  test('should create a group, extract its details, and then join it', async ({ page }) => {
    // === Part 1: Create a group and extract its details ===

    // 1. Trigger "Create Group"
    await page.locator('#identity-panel button:has-text("New Group")').click();
    await expect(page.locator('.modal-content h3:has-text("Create Group")')).toBeVisible();

    // 2. Input group name and submit
    await page.locator('.modal-content input[name="name"]').fill(sourceGroupName);
    await page.locator('.modal-content button:has-text("Create")').click();
    await expect(page.locator(`.toast:has-text('Group "${sourceGroupName}" created.')`)).toBeVisible();
    await page.waitForSelector(`.toast:has-text('Group "${sourceGroupName}" created.')`, { state: 'hidden' });

    // 3. Extract details from "Group Info" modal
    await expect(page.locator('.modal-content h3:has-text("Group Info")')).toBeVisible();
    const groupId = await page.locator('.modal-content input[name="id"]').inputValue();
    const groupKey = await page.locator('.modal-content input[name="key"]').inputValue();
    expect(groupId).toBeTruthy();
    expect(groupKey).toBeTruthy();
    await page.locator('.modal-content button:has-text("Close")').click();
    await expect(page.locator('.modal-content h3:has-text("Group Info")')).not.toBeVisible();

    // 4. Verify source group is in thought list (and active)
    const sourceGroupThought = page.locator(`#thoughts-list .thought-item.active .thought-name span:has-text("${sourceGroupName}")`);
    await expect(sourceGroupThought).toBeVisible();

    // === Part 2: Join the group using extracted details ===

    // 5. Trigger "Join Group"
    await page.locator('#identity-panel button:has-text("Join Group")').click();
    await expect(page.locator('.modal-content h3:has-text("Join Group")')).toBeVisible();

    // 6. Input extracted details and new local name
    await page.locator('.modal-content input[name="id"]').fill(groupId);
    await page.locator('.modal-content input[name="key"]').fill(groupKey);
    await page.locator('.modal-content input[name="name"]').fill(joinedGroupName); // This name is mandatory for joinGroupThought

    // 7. Click "Join"
    await page.locator('.modal-content button:has-text("Join")').click();

    // 8. Verify success toast for joining group
    // From src/index.js joinGroupThought, the toast is `Joined group "${name}".`
    await expect(page.locator(`.toast:has-text('Joined group "${joinedGroupName}".')`)).toBeVisible();
    await page.waitForSelector(`.toast:has-text('Joined group "${joinedGroupName}".')`, { state: 'hidden' });

    // 9. Verify newly joined group appears in thought list and is active
    const joinedGroupThought = page.locator(`#thoughts-list .thought-item.active .thought-name span:has-text("${joinedGroupName}")`);
    await expect(joinedGroupThought).toBeVisible();

    // 10. Verify main view shows message list for this joined group
    await expect(page.locator('#note-editor-container')).not.toBeVisible();
    await expect(page.locator('#message-list-container')).toBeVisible();
    await expect(page.locator('#message-input-form')).toBeVisible();

    // Optional: Send a message to the joined group to be thorough, though not explicitly in this subtask's steps
    const groupMessageText = 'Hello from the joined group!';
    await page.locator('#message-input').fill(groupMessageText);
    await page.locator('#message-input-form button:has-text("Send")').click();
    await expect(page.locator('.toast:has-text("Message sent!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Message sent!")', { state: 'hidden' });
    const sentGroupMessage = page.locator('#message-list .message.self .message-text');
    await expect(sentGroupMessage).toHaveText(groupMessageText);
    await expect(page.locator('#message-list .message.self .message-sender:has-text("You")')).toBeVisible();
  });
});

test.describe('Group Creation and Sending Message', () => {
  const testGroupName = 'Test E2E Group';

  test.beforeEach(async ({ page }) => {
    // Create a new identity first
    await page.locator('#identity-panel button:has-text("Load/Create")').click();
    await page.locator('.modal-content button:has-text("Load/Gen")').click();
    await expect(page.locator('.toast:has-text("Identity loaded!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Identity loaded!")', { state: 'hidden' });
  });

  test('should create a new group, send a message, and see it in the list', async ({ page }) => {
    // 1. Trigger "Create Group" functionality
    await page.locator('#identity-panel button:has-text("New Group")').click();

    // 2. Verify Create Group modal is visible
    await expect(page.locator('.modal-content h3:has-text("Create Group")')).toBeVisible();

    // 3. Input group name
    await page.locator('.modal-content input[name="name"]').fill(testGroupName);

    // 4. Submit the modal to create the group
    await page.locator('.modal-content button:has-text("Create")').click();

    // 5. Verify success toast for group creation
    await expect(page.locator(`.toast:has-text('Group "${testGroupName}" created.')`)).toBeVisible();
    await page.waitForSelector(`.toast:has-text('Group "${testGroupName}" created.')`, { state: 'hidden' });

    // EXTRA STEP: Handle the "Group Info" modal that appears after creation
    // Based on src/index.js createGroupThought, a 'groupInfo' modal is shown.
    // We need to close it to proceed. Assume it has a "Close" or "Done" button.
    // Let's check for a generic close button if specific one is not known.
    // Common modal close patterns: button with text "Close", "Done", or an "x" icon.
    // From src/ui/modals/group-info-modal.js, the title is "Group Info"
    // and it has a "Close" button.
    await expect(page.locator('.modal-content h3:has-text("Group Info")')).toBeVisible(); // Verify Group Info modal
    await page.locator('.modal-content button:has-text("Close")').click(); // Close Group Info modal
    await expect(page.locator('.modal-content h3:has-text("Group Info")')).not.toBeVisible(); // Verify it's closed


    // 6. Verify new group thought appears in the thoughts list with the specified name and is active
    const newGroupThought = page.locator(`#thoughts-list .thought-item.active .thought-name span:has-text("${testGroupName}")`);
    await expect(newGroupThought).toBeVisible();

    // 7. Verify main view shows message list view for this group
    await expect(page.locator('#note-editor-container')).not.toBeVisible();
    await expect(page.locator('#message-list-container')).toBeVisible();
    await expect(page.locator('#message-input-form')).toBeVisible();

    // 8. Type a message into the message input
    const groupMessageText = 'Hello, this is a Group E2E test message!';
    await page.locator('#message-input').fill(groupMessageText);

    // 9. Send the message
    await page.locator('#message-input-form button:has-text("Send")').click();

    // 10. Verify success toast for message sent
    await expect(page.locator('.toast:has-text("Message sent!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Message sent!")', { state: 'hidden' });

    // 11. Verify sent message appears in the message list
    const sentGroupMessage = page.locator('#message-list .message.self .message-text');
    await expect(sentGroupMessage).toHaveText(groupMessageText);
    await expect(page.locator('#message-list .message.self .message-sender:has-text("You")')).toBeVisible();
  });
});

test.describe('Direct Message (DM) Creation and Sending', () => {
  const testNpub = 'npub10elfcs4fr0l0p8afmanusmljjx6qg3dcwjh5hptsevyawu00x3nhmqux99';
  // This should be the shortened HEX pubkey, as that's what createDmThought uses for the name
  const testHexPkShort = '00000070...e73f';

  test.beforeEach(async ({ page }) => {
    // Create a new identity first
    await page.locator('#identity-panel button:has-text("Load/Create")').click();
    await page.locator('.modal-content button:has-text("Load/Gen")').click();
    await expect(page.locator('.toast:has-text("Identity loaded!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Identity loaded!")', { state: 'hidden' });
  });

  test('should create a new DM, send a message, and see it in the list', async ({ page }) => {
    // 1. Trigger "Create DM" functionality
    // Assuming a button like "New DM" exists in the identity panel or a similar place.
    // This selector might need adjustment based on actual UI.
    await page.locator('#identity-panel button:has-text("New DM")').click(); // Placeholder selector

    // 2. Verify Create DM modal is visible
    await expect(page.locator('.modal-content h3:has-text("New Direct Message")')).toBeVisible();

    // 3. Input a valid Nostr public key
    await page.locator('.modal-content input[name="pubkey"]').fill(testNpub);

    // 4. Submit the modal
    await page.locator('.modal-content button:has-text("Start DM")').click();

    // 5. Verify success toast for DM creation
    // From src/index.js createDmThought, the toast is "DM started."
    await expect(page.locator('.toast:has-text("DM started.")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("DM started.")', { state: 'hidden' });

    // 6. Verify new DM thought appears in the thoughts list (name is shortened hex pubkey)
    // and is active.
    const newDmThought = page.locator(`#thoughts-list .thought-item.active .thought-name span:has-text("${testHexPkShort}")`);
    await expect(newDmThought).toBeVisible();

    // 7. Verify main view shows message list for this DM
    // This usually means the note editor is not visible, and message list + input are.
    await expect(page.locator('#note-editor-container')).not.toBeVisible();
    await expect(page.locator('#message-list-container')).toBeVisible(); // Assuming a container for message list and input
    await expect(page.locator('#message-input-form')).toBeVisible();


    // 8. Type a message into the message input
    const dmMessageText = 'Hello, this is a DM E2E test message!';
    await page.locator('#message-input').fill(dmMessageText);

    // 9. Send the message
    await page.locator('#message-input-form button:has-text("Send")').click();

    // 10. Verify success toast for message sent
    await expect(page.locator('.toast:has-text("Message sent!")')).toBeVisible();
    await page.waitForSelector('.toast:has-text("Message sent!")', { state: 'hidden' });

    // 11. Verify sent message appears in the message list
    const sentDmMessage = page.locator('#message-list .message.self .message-text');
    await expect(sentDmMessage).toHaveText(dmMessageText);
    await expect(page.locator('#message-list .message.self .message-sender:has-text("You")')).toBeVisible();
  });
});
