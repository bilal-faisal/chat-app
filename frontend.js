import { sendMessage, getChatMessages, startListeningForMessages } from 'backend/chatapp.jsw';
import { subscribe, unsubscribe } from 'wix-realtime';
import { currentUser } from 'wix-users';
import wixWindow from 'wix-window';
import wixLocation from 'wix-location';
import wixData from 'wix-data';

let senderID;
let currentConvoID = ""
let messageList = [];
let userConversations = [];
let lastMessageTimestamp = 0;
let activeChannel = null;
let activeSubscriptionId = null;
let isMessageHandlerSet = false;
let filteredConversations = [];

$w.onReady(async () => {

    $w("#repeaterChat").data = []
    $w("#repeaterConversations").data = []

    if (currentUser.loggedIn) {
        senderID = currentUser.id;
        console.log("Logged-in user's ID:", senderID);
    } else {
        console.error("User not logged in");
        wixLocation.to("/");
        return;
    }

    const queryParams = wixLocation.query;
    const conversationID = queryParams.conversationID;

    await fetchUserConversations(senderID);
    if (conversationID) {
        console.log("Conversation ID provided:", conversationID);
        await setupConversation(conversationID)
    } else {

        console.log("No conversation ID provided.");
        if (userConversations.length > 0) {
            const conversationID = userConversations[0].conversationID
            await setupConversation(conversationID)
        }
    }
    $w("#inputSearchConversations").onInput(() => {
        handleSearchConversations();
    });
});

async function setupConversation(conversationID) {
    const convo = userConversations.find((con) => con.conversationID === conversationID);
    if (!convo) {
        console.error("Invalid or missing conversation ID");
        return;
    }

    // Update the current conversation ID
    currentConvoID = conversationID;

    // Reset variables and UI
    messageList = [];
    $w("#repeaterChat").data = [];
    updateRepeaterMessages();
    lastMessageTimestamp = 0;


    if (senderID == convo.sellerUserId) {
        $w("#imageProfilePictureSelected").src = convo.buyerProfilePhoto;
        $w("#textNameSelected").text = convo.buyerFullName;
        $w("#textUserNameSelected").text = convo.buyerUserName;
    } else if (senderID == convo.buyerUserId) {
        $w("#imageProfilePictureSelected").src = convo.sellerProfilePhoto;
        $w("#textNameSelected").text = convo.sellerFullName;
        $w("#textUserNameSelected").text = convo.sellerUserName;
    }

    // Start listening for messages in the backend for the current conversationID
    await startListeningForMessages(conversationID);

    // Load previous messages for the new conversation
    await loadPreviousMessages(conversationID);

    if (activeSubscriptionId) {
        await unsubscribe({ subscriptionId: activeSubscriptionId });
        console.log(`Unsubscribed from channel: ${activeChannel}`);
    }

    // Set the active channel
    activeChannel = `chatMessages_${conversationID}`;

    // Subscribe to real-time updates
    const channel = { name: activeChannel };
    await subscribe(channel, (message) => {
        const { payload } = message;
        const { sender, message: messageText, timestamp } = payload;

        if (activeChannel === `chatMessages_${conversationID}` && sender && messageText && timestamp > lastMessageTimestamp) {
            lastMessageTimestamp = timestamp;
            messageList.push({
                _id: `${timestamp}-${messageList.length}`,
                sender,
                messageText,
                timestamp,
            });
            updateRepeaterMessages();
        } else if (activeChannel !== `chatMessages_${conversationID}`) {
            console.warn(`Message received for a different conversation: ${conversationID}`);
        } else {
            console.warn("Duplicate or incomplete message data:", payload);
        }
    })
        .then((subscriptionId) => {
            activeSubscriptionId = subscriptionId;
            console.log(`Subscribed to conversation: ${conversationID} with subscription ID: ${activeSubscriptionId}`);
        });

    setupMessageHandlers(senderID);
}

function setupMessageHandlers(senderID) {
    if (isMessageHandlerSet) {
        // Prevent adding multiple handlers
        return;
    }

    $w("#buttonSendMessage").onClick(() => sendMessageHandler(senderID));
    $w("#inputUserMessage").onKeyPress((event) => {
        if (event.key === "Enter") {
            sendMessageHandler(senderID);
        }
    });

    // Mark handlers as set
    isMessageHandlerSet = true;
}


// Send message handler
async function sendMessageHandler(senderID) {
    const messageText = $w("#inputUserMessage").value.trim();
    if (messageText) {
        try {
            if (!currentConvoID) {
                console.error("No active conversation. Message not sent.");
                return;
            }

            await sendMessage(currentConvoID, senderID, messageText);
            // console.log("Message sent successfully!");
            $w("#inputUserMessage").value = "";
        } catch (error) {
            console.error("Error sending message:", error);
        }
    }
}

async function loadPreviousMessages(conversationID) {
    try {
        const messages = await getChatMessages(conversationID);
        messages.forEach((message) => {
            const isDuplicate = messageList.some((msg) => msg._id === `${message.timestamp}-${messageList.length}`);
            if (!isDuplicate) {
                messageList.push({
                    _id: `${message.timestamp}-${messageList.length}`,
                    sender: message.sender,
                    messageText: message.message,
                    timestamp: message.timestamp,
                });
                lastMessageTimestamp = Math.max(lastMessageTimestamp, message.timestamp);
            }
        });

        updateRepeaterMessages();
    } catch (error) {
        console.error("Error loading previous messages:", error);
    }
}

function updateRepeaterMessages() {
    $w("#repeaterChat").data = messageList;
    const repeaterLength = $w("#repeaterChat").data.length;

    $w("#repeaterChat").onItemReady(($item, itemData, index) => {
        const { sender, messageText, timestamp } = itemData;

        const messageTime = timestamp && !isNaN(timestamp) ?
            new Date(parseInt(timestamp)).toLocaleString('en-US', {
                hour: 'numeric',
                minute: 'numeric',
                hour12: true,
            }) :
            "Unknown Time";

        if (sender === currentUser.id) {
            // Display message in the sender box
            $item("#boxSender").expand();
            $item("#boxReceiver").collapse();
            $item("#textMessageSender").text = messageText;
            $item("#textMessageTimeSender").text = messageTime;
        } else {
            // Display message in the receiver box
            $item("#boxSender").collapse();
            $item("#boxReceiver").expand();
            $item("#textMessageReceiver").text = messageText;
            $item("#textMessageTimeReceiver").text = messageTime;
        }

        if (index === repeaterLength - 1) {
            setTimeout(() => {
                wixWindow.postMessage("scrollToChatBottom");
            }, 150);
        }
    });
}

async function fetchUserConversations(userID) {
    try {
        const results = await wixData.query("ChatDetails")
            .contains("conversationID", userID)
            .find();

        if (results.items.length > 0) {
            console.log("Conversations for user:", results.items);

            // Populate conversations UI (repeater)
            populateConversationsUI(results.items);

            userConversations = results.items
        } else {
            console.warn("No conversations found for this user");
            // $w("#textNoConversations").show();
        }
    } catch (error) {
        console.error("Error fetching user conversations:", error);
    }
}

function populateConversationsUI(conversationList) {

    $w("#repeaterConversations").data = conversationList;

    $w("#repeaterConversations").onItemReady(($item, itemData) => {
        if (senderID == itemData.sellerUserId) {

            $item("#imageProfilePicture").src = itemData.buyerProfilePhoto;
            $item("#textName").text = itemData.buyerFullName;
            $item("#textUserName").text = itemData.buyerUserName;

        } else if (senderID == itemData.buyerUserId) {

            $item("#imageProfilePicture").src = itemData.sellerProfilePhoto;
            $item("#textName").text = itemData.sellerFullName;
            $item("#textUserName").text = itemData.sellerUserName;
        }

        $item("#box94").hide()
        $item("#text76").hide()

        $item("#boxConversation").onClick(async () => {
            if (itemData.conversationID !== currentConvoID) {
                messageList = [];
                $w("#repeaterChat").data = [];
                updateRepeaterMessages();
                await setupConversation(itemData.conversationID);
            }
        });


    });
}

function handleSearchConversations() {
    const searchTerm = $w("#inputSearchConversations").value.trim().toLowerCase();

    if (searchTerm) {
        // Filter conversations based on buyer or seller name
        filteredConversations = userConversations.filter((convo) => {
            const buyerName = `${convo.buyerFullName}`.toLowerCase();
            const sellerName = `${convo.sellerFullName}`.toLowerCase();
            return buyerName.includes(searchTerm) || sellerName.includes(searchTerm);
        });
    } else {
        // If search term is empty, show all conversations
        filteredConversations = userConversations;
    }

    // Update the repeater with filtered results
    populateConversationsUI(filteredConversations);
}


// $w.onReady(() => {
//     if (wixWindow.formFactor === "Mobile") {
//         $w("#vectorImage8").onClick(() => {
//             $w("#flexBox").customClassList.remove("showMessage")
//         })
//         $w("#repeater1").forEachItem(($item) => {
//             $item("#box93").onClick(() => {
//                 $w("#flexBox").customClassList.add("showMessage")
//             })
//         })
//     }
// });