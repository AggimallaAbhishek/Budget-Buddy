// Define a fallback configuration using the user-provided details
const FALLBACK_FIREBASE_CONFIG = {
    apiKey: "AIzaSyC0dGDNnGf34AAv-TRXX7Ldrae1X8HG6Aw",
    authDomain: "budgetbuddy-551ff.firebaseapp.com",
    projectId: "budgetbuddy-551ff",
    storageBucket: "budgetbuddy-551ff.firebasestorage.app",
    messagingSenderId: "201578069546",
    appId: "1:201578069546:web:092409a04136dbd67e4d53",
    measurementId: "G-XST7WHDH11"
};

// Global Firebase variables provided by the Canvas environment
let canvasFirebaseConfig = null;
try {
    // Attempt to parse the environment variable config
    canvasFirebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
} catch (e) {
    console.error("Error parsing __firebase_config:", e);
}

// Use environment config if available, otherwise use the provided fallback config
const firebaseConfig = canvasFirebaseConfig || FALLBACK_FIREBASE_CONFIG;

// Use projectId as fallback for appId, which is required for firestore paths
const appId = typeof __app_id !== 'undefined' ? __app_id : firebaseConfig.projectId;
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Firebase Imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    signInWithCustomToken,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithRedirect,
    getRedirectResult,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, setLogLevel, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global variables for Firebase instances
let app, db, auth;
let userId = null;
let unsubscribeTransactions = null; // Store listener Unsubscribe function

// Set Firebase logging level to debug for easy issue identification
setLogLevel('debug');

const loadingMessage = document.getElementById('loading-message');
const transactionListElement = document.getElementById('transaction-list');
const loadingView = document.getElementById('loading-view');
const landingView = document.getElementById('landing-view');
const dashboardView = document.getElementById('dashboard-view');
const userNameElement = document.getElementById('user-name');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const landingError = document.getElementById('landing-error');

/**
 * Initializes Firebase and authenticates the user.
 */
async function initializeFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);

        // Listen for auth state changes
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                // User is signed in
                userId = user.uid;
                const displayName = user.displayName || 'User';
                userNameElement.textContent = displayName;

                showDashboard();
                setupTransactionListener();
            } else {
                // User is signed out
                userId = null;
                showLanding();
                if (unsubscribeTransactions) {
                    unsubscribeTransactions(); // Stop listening to old user's data
                    unsubscribeTransactions = null;
                }
            }
            // Hide loading view once auth is determined
            loadingView.classList.add('hidden');
        });

        // Handle redirect result (for errors during sign-in)
        try {
            await getRedirectResult(auth);
        } catch (error) {
            console.error("Redirect Sign-in Error:", error);
            let errorMessage = `Sign-in failed: ${error.message}`;

            if (error.code === 'auth/unauthorized-domain') {
                const currentDomain = window.location.hostname;
                errorMessage = `
                    <div class="mb-2"><span class="font-bold">Error: Unauthorized Domain (${currentDomain})</span></div>
                    <div class="mb-2">Please add below domain to Firebase Console > Authentication > Settings > Authorized Domains:</div>
                    <div class="flex items-center justify-center gap-2">
                        <code class="bg-gray-100 px-2 py-1 rounded select-all">${currentDomain}</code>
                        <button onclick="navigator.clipboard.writeText('${currentDomain}')" class="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded transition-colors" title="Copy to clipboard">
                            Copy
                        </button>
                    </div>
                `;
            }

            landingError.innerHTML = errorMessage;
            landingError.classList.remove('hidden');
        }

        // Handle initial custom token sign-in (if provided by environment)
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        }

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        landingError.textContent = `Initialization Error: ${error.message}`;
        landingError.classList.remove('hidden');
    }
}

/**
 * Sign in with Google (Redirect Mode)
 */
async function loginWithGoogle() {
    landingError.classList.add('hidden');
    const provider = new GoogleAuthProvider();

    try {
        await signInWithRedirect(auth, provider);
        // Page will redirect, handling result on reload in initializeFirebase
    } catch (error) {
        console.error("Google Sign-in Error:", error);
        landingError.textContent = `Sign-in failed: ${error.message}`;
        landingError.classList.remove('hidden');
    }
}

/**
 * Sign out
 */
async function logout() {
    try {
        await signOut(auth);
        // Successful logout will trigger onAuthStateChanged -> showLanding
    } catch (error) {
        console.error("Sign-out Error:", error);
    }
}

/**
 * UI State Management
 */
function showDashboard() {
    landingView.classList.add('hidden');
    dashboardView.classList.remove('hidden');
}

function showLanding() {
    dashboardView.classList.add('hidden');
    landingView.classList.remove('hidden');
}

/**
 * Returns the collection reference for the current user's transactions.
 */
function getTransactionsCollection() {
    if (!db || !userId) {
        console.error("Database or User ID not ready.");
        return null;
    }
    // Private data path: /artifacts/{appId}/users/{userId}/transactions
    const path = `artifacts/${appId}/users/${userId}/transactions`;
    return collection(db, path);
}

/**
 * Adds a new transaction to Firestore.
 */
async function addTransaction(description, rawAmount, type) {
    const formMessage = document.getElementById('form-message');
    formMessage.classList.add('hidden');

    // Ensure amount is positive and convert to Rupee (keep sign logic)
    let amount = parseFloat(rawAmount);
    if (isNaN(amount) || amount <= 0) {
        showMessage("Amount must be a positive number.", 'text-red-500');
        return;
    }
    if (description.trim() === '') {
        showMessage("Description cannot be empty.", 'text-red-500');
        return;
    }

    // Apply sign based on type
    if (type === 'expense') {
        amount = -Math.abs(amount); // Ensure expense is negative
    } else {
        amount = Math.abs(amount); // Ensure income is positive
    }

    const transactionsCollection = getTransactionsCollection();
    if (!transactionsCollection) return;

    try {
        await addDoc(transactionsCollection, {
            description: description.trim(),
            amount: amount,
            type: type, // 'income' or 'expense'
            timestamp: serverTimestamp(), // Use server timestamp for ordering
        });
        showMessage("Transaction recorded successfully!", 'text-emerald-600');
        document.getElementById('description').value = '';
        document.getElementById('amount').value = '';
    } catch (e) {
        console.error("Error adding document: ", e);
        showMessage(`Failed to save transaction: ${e.message}`, 'text-red-500');
    }
}

/**
 * Deletes a transaction from Firestore.
 */
async function deleteTransaction(id) {
    const confirmDelete = window.confirm ? window.confirm("Are you sure you want to delete this transaction?") : true;

    if (!confirmDelete) return;

    const transactionsCollection = getTransactionsCollection();
    if (!transactionsCollection) return;

    try {
        await deleteDoc(doc(transactionsCollection, id));
        // UI will automatically update via the onSnapshot listener
    } catch (e) {
        console.error("Error deleting document: ", e);
        console.error(`Failed to delete transaction: ${e.message}`);
    }
}

/**
 * Sets up the real-time listener for transactions.
 */
function setupTransactionListener() {
    if (unsubscribeTransactions) {
        unsubscribeTransactions(); // Clean up existing listener if called multiple times
    }

    const transactionsCollection = getTransactionsCollection();
    if (!transactionsCollection) return;

    loadingMessage.classList.remove('hidden');

    const q = query(transactionsCollection, orderBy("timestamp", "desc"));

    // Real-time listener
    unsubscribeTransactions = onSnapshot(q, (snapshot) => {
        loadingMessage.classList.add('hidden');
        const transactions = [];
        let totalIncome = 0;
        let totalExpenses = 0;

        snapshot.forEach((doc) => {
            const data = doc.data();
            const transaction = {
                id: doc.id,
                description: data.description,
                amount: data.amount,
                type: data.type,
                timestamp: data.timestamp ? data.timestamp.toDate() : new Date(),
            };
            transactions.push(transaction);

            if (transaction.type === 'income') {
                totalIncome += Math.abs(transaction.amount);
            } else if (transaction.type === 'expense') {
                totalExpenses += Math.abs(transaction.amount);
            }
        });

        const totalBalance = totalIncome - totalExpenses;

        updateSummary(totalBalance, totalIncome, totalExpenses);
        renderTransactions(transactions);
        renderPieChart(totalIncome, totalExpenses);
    }, (error) => {
        console.error("Error listening to transactions: ", error);
        loadingMessage.classList.add('hidden');

        let displayError = `Data Error: ${error.message}`;
        if (error.code === 'permission-denied') {
            // Handle silently or show toast, main UI shouldn't break completely
            console.error("Permission Denied: Ensure user is logged in.");
        }
    });
}

/**
 * Currency formatter for Rupee (INR).
 */
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
};

/**
 * Updates the balance summary display.
 */
function updateSummary(balance, income, expenses) {
    const balanceElement = document.getElementById('total-balance');
    balanceElement.textContent = formatCurrency(balance);
    balanceElement.classList.remove('text-rose-600', 'text-emerald-600', 'text-slate-800');

    if (balance > 0) {
        balanceElement.classList.add('text-emerald-600');
    } else if (balance < 0) {
        balanceElement.classList.add('text-rose-600');
    } else {
        balanceElement.classList.add('text-slate-800');
    }

    document.getElementById('total-income').textContent = formatCurrency(income);
    document.getElementById('total-expenses').textContent = formatCurrency(expenses);
}

/**
 * Renders the list of transactions.
 */
function renderTransactions(transactions) {
    transactionListElement.innerHTML = '';

    if (transactions.length === 0) {
        const emptyRow = document.createElement('li');
        emptyRow.className = "p-4 text-center text-gray-500";
        emptyRow.id = "empty-list-message";
        emptyRow.textContent = "No transactions recorded yet. Start by adding one above!";
        transactionListElement.appendChild(emptyRow);
        return;
    }

    transactions.forEach(tx => {
        const isIncome = tx.type === 'income';
        const amountValue = formatCurrency(Math.abs(tx.amount));

        const creditCell = isIncome ? `<span class="font-medium text-emerald-600">${amountValue}</span>` : '';
        const debitCell = !isIncome ? `<span class="font-medium text-rose-600">${amountValue}</span>` : '';

        const formattedDate = new Intl.DateTimeFormat('en-IN', {
            month: 'short', day: 'numeric', year: 'numeric'
        }).format(tx.timestamp);

        const formattedTime = new Intl.DateTimeFormat('en-IN', {
            hour: '2-digit', minute: '2-digit', hour12: true
        }).format(tx.timestamp);

        const listItem = document.createElement('li');
        listItem.className = `transaction-item`;
        listItem.innerHTML = `
            <div class="text-left text-sm text-gray-600">${formattedDate}</div>
            <div class="text-left text-sm text-gray-600">${formattedTime}</div>
            <div class="text-left text-sm text-gray-800 font-medium">${tx.description}</div>
            <div class="text-right text-sm">${creditCell}</div>
            <div class="text-right text-sm">${debitCell}</div>
            <div class="flex justify-end">
                <button class="text-gray-400 hover:text-red-500 transition duration-150 p-1 rounded-full" 
                        data-id="${tx.id}" aria-label="Delete transaction">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 10-2 0v6a1 1 0 102 0V8z" clip-rule="evenodd" />
                        </svg>
                </button>
            </div>
        `;

        listItem.querySelector('button').addEventListener('click', (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            deleteTransaction(id);
        });

        transactionListElement.appendChild(listItem);
    });
}

/**
 * Renders the D3.js Pie/Donut chart.
 */
function renderPieChart(totalIncome, totalExpenses) {
    const data = [
        { label: 'Income', value: totalIncome, color: '#10b981' },
        { label: 'Expense', value: totalExpenses, color: '#ef4444' }
    ];

    const total = totalIncome + totalExpenses;
    const displayData = data.filter(d => d.value > 0);
    const container = document.getElementById('pie-chart');
    container.innerHTML = '';

    if (total === 0 || displayData.length === 0) {
        container.innerHTML =
            '<div class="text-center text-gray-500 p-8">No transaction data available to generate chart.</div>';
        return;
    }

    const size = 300;
    const radius = size / 2;

    const svg = d3.select("#pie-chart")
        .append("svg")
        .attr("viewBox", `0 0 ${size} ${size}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("display", "block")
        .style("max-width", "300px")
        .style("margin", "auto")
        .append("g")
        .attr("transform", `translate(${size / 2}, ${size / 2})`);

    const pie = d3.pie()
        .value(d => d.value)
        .sort(null);

    const arc = d3.arc()
        .innerRadius(radius * 0.5)
        .outerRadius(radius);

    const arcs = svg.selectAll(".arc")
        .data(pie(displayData))
        .enter()
        .append("g")
        .attr("class", "arc");

    arcs.append("path")
        .attr("d", arc)
        .attr("fill", (d, i) => displayData[i].color)
        .attr("stroke", "white")
        .style("stroke-width", "2px")
        .append("title")
        .text(d => `${d.data.label}: ${formatCurrency(d.data.value)} (${(d.data.value / total * 100).toFixed(1)}%)`);

    const netBalance = totalIncome - totalExpenses;
    const balanceColor = netBalance >= 0 ? '#10b981' : '#ef4444';

    svg.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", balanceColor)
        .attr("font-size", "1.1rem")
        .attr("font-weight", "bold")
        .text("Net");

    svg.append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", balanceColor)
        .attr("font-size", "0.9rem")
        .attr("dy", "1.5em")
        .text(formatCurrency(netBalance));
}

/**
 * Displays a temporary message in the form area.
 */
function showMessage(text, colorClass) {
    const formMessage = document.getElementById('form-message');
    formMessage.textContent = text;
    formMessage.className = `mt-3 text-sm text-center ${colorClass}`;
    formMessage.classList.remove('hidden');

    setTimeout(() => {
        formMessage.classList.add('hidden');
    }, 3000);
}

// --- Event Listeners and Initialization ---

const descriptionInput = document.getElementById('description');
const amountInput = document.getElementById('amount');
const incomeBtn = document.getElementById('income-btn');
const expenseBtn = document.getElementById('expense-btn');

incomeBtn.addEventListener('click', function (e) {
    e.preventDefault();
    addTransaction(descriptionInput.value, amountInput.value, 'income');
});

expenseBtn.addEventListener('click', function (e) {
    e.preventDefault();
    addTransaction(descriptionInput.value, amountInput.value, 'expense');
});

// Auth Listeners
if (googleLoginBtn) {
    googleLoginBtn.addEventListener('click', loginWithGoogle);
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
}

// Initialize the application when the script loads
initializeFirebase();
