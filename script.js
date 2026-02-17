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
    signInWithPopup,
    setPersistence,
    browserLocalPersistence,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore, collection, addDoc, onSnapshot, query, orderBy, deleteDoc, doc, setLogLevel, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global variables for Firebase instances
let app, db, auth;
let userId = null;
let unsubscribeTransactions = null; // Store listener Unsubscribe function
let currentTransactionType = 'expense'; // Default for modal

// Set Firebase logging level to debug for easy issue identification
setLogLevel('debug');

// DOM Elements
const loadingMessage = document.getElementById('loading-message'); // Note: Removed from new HTML, can remove usage
const transactionListElement = document.getElementById('transaction-list');
const loadingView = document.getElementById('loading-view');
const landingView = document.getElementById('landing-view');
const dashboardView = document.getElementById('dashboard-view');
const userNameElement = document.getElementById('user-name');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const landingError = document.getElementById('landing-error');

// Modal Elements
const modal = document.getElementById('transaction-modal');
const quickAddBtn = document.getElementById('quick-add-btn');
const closeModalBtn = document.getElementById('close-modal-btn');
const saveTransactionBtn = document.getElementById('save-transaction-btn');
const modalTypeExpense = document.getElementById('modal-type-expense');
const modalTypeIncome = document.getElementById('modal-type-income');
const modalAmount = document.getElementById('modal-amount');
const modalDescription = document.getElementById('modal-description');
const modalCategory = document.getElementById('modal-category');
const modalMessage = document.getElementById('modal-message');
const themeToggleBtn = document.getElementById('theme-toggle');


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
                if (userNameElement) userNameElement.textContent = displayName;

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
            if (loadingView) loadingView.classList.add('hidden');
        });

        // Ensure persistence is set to LOCAL
        try {
            await setPersistence(auth, browserLocalPersistence);
        } catch (error) {
            console.error("Persistence Error:", error);
        }

        // Handle initial custom token sign-in (if provided by environment)
        if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
        }

    } catch (error) {
        console.error("Firebase Initialization Error:", error);
        if (landingError) {
            landingError.textContent = `Initialization Error: ${error.message}. Please refresh or check console.`;
            landingError.classList.remove('hidden');
        }
        if (loadingView) loadingView.classList.add('hidden');
        if (landingView) landingView.classList.remove('hidden');
    }
}

// Safety timeout
setTimeout(() => {
    if (loadingView && !loadingView.classList.contains('hidden')) {
        console.warn("Auth listener timeout - forcing landing view.");
        loadingView.classList.add('hidden');
        landingView.classList.remove('hidden');
        if (landingError) {
            landingError.textContent = "Connection timed out. Please check your internet and refresh.";
            landingError.classList.remove('hidden');
        }
    }
}, 8000);


/**
 * Sign in with Google (Popup Mode)
 */
async function loginWithGoogle() {
    landingError.classList.add('hidden');
    const provider = new GoogleAuthProvider();

    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        console.error("Google Sign-in Error:", error);
        let errorMessage = `Sign-in failed: ${error.message}`;
        if (error.code === 'auth/popup-closed-by-user') {
            errorMessage = "Sign-in cancelled by user.";
        }
        landingError.textContent = errorMessage;
        landingError.classList.remove('hidden');
    }
}

/**
 * Sign out
 */
async function logout() {
    try {
        await signOut(auth);
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
 * Modal Logic
 */
function openModal() {
    modal.classList.remove('hidden');
    // Reset fields
    modalAmount.value = '';
    modalDescription.value = '';
    modalCategory.selectedIndex = 0; // Default to first option
    modalMessage.classList.add('hidden');
    // Default to expense
    setModalType('expense');
}

function closeModal() {
    modal.classList.add('hidden');
}

function setModalType(type) {
    currentTransactionType = type;

    // Toggle UI classes
    if (type === 'expense') {
        modalTypeExpense.className = "flex-1 py-2.5 rounded-lg font-bold text-sm transition-all bg-white text-rose-600 shadow-sm ring-1 ring-black/5";
        modalTypeIncome.className = "flex-1 py-2.5 rounded-lg font-bold text-sm text-primary/60 hover:text-emerald-600 transition-all";
    } else {
        modalTypeIncome.className = "flex-1 py-2.5 rounded-lg font-bold text-sm transition-all bg-white text-emerald-600 shadow-sm ring-1 ring-black/5";
        modalTypeExpense.className = "flex-1 py-2.5 rounded-lg font-bold text-sm text-primary/60 hover:text-rose-600 transition-all";
    }
}

/**
 * DB Operations
 */
function getTransactionsCollection() {
    if (!db || !userId) return null;
    return collection(db, `artifacts/${appId}/users/${userId}/transactions`);
}

async function startAddTransaction() {
    const description = modalDescription.value.trim();
    const rawAmount = modalAmount.value;
    const category = modalCategory.value;
    const type = currentTransactionType;

    modalMessage.classList.add('hidden');

    // Validation
    let amount = parseFloat(rawAmount);
    if (isNaN(amount) || amount <= 0) {
        showModalError("Please enter a valid amount.");
        return;
    }
    if (description === '') {
        showModalError("Please enter a description.");
        return;
    }

    // Apply sign
    if (type === 'expense') {
        amount = -Math.abs(amount);
    } else {
        amount = Math.abs(amount);
    }

    const transactionsCollection = getTransactionsCollection();
    if (!transactionsCollection) return;

    try {
        // Show loading state on button
        const originalBtnText = saveTransactionBtn.innerHTML;
        saveTransactionBtn.textContent = "Saving...";
        saveTransactionBtn.disabled = true;

        await addDoc(transactionsCollection, {
            description: description,
            amount: amount,
            category: category,
            type: type,
            status: 'Completed', // Default status for now
            timestamp: serverTimestamp(),
        });

        // Reset and close
        closeModal();
        saveTransactionBtn.innerHTML = originalBtnText;
        saveTransactionBtn.disabled = false;

    } catch (e) {
        console.error("Error adding document: ", e);
        showModalError(`Failed: ${e.message}`);
        saveTransactionBtn.disabled = false;
    }
}

function showModalError(msg) {
    modalMessage.textContent = msg;
    modalMessage.className = "text-center text-sm font-medium text-rose-500";
    modalMessage.classList.remove('hidden');
}

async function deleteTransaction(id) {
    if (!confirm("Delete this transaction?")) return;

    const transactionsCollection = getTransactionsCollection();
    if (!transactionsCollection) return;

    try {
        await deleteDoc(doc(transactionsCollection, id));
    } catch (e) {
        console.error("Error deleting document: ", e);
    }
}

/**
 * Real-time Listener
 */
function setupTransactionListener() {
    if (unsubscribeTransactions) unsubscribeTransactions();

    const transactionsCollection = getTransactionsCollection();
    if (!transactionsCollection) return;

    const q = query(transactionsCollection, orderBy("timestamp", "desc"));

    unsubscribeTransactions = onSnapshot(q, (snapshot) => {
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
                category: data.category || 'Others', // Fallback for old data
                status: data.status || 'Completed',
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
    });
}

/**
 * Helpers
 */
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(amount);
};

function updateSummary(balance, income, expenses) {
    document.getElementById('total-balance').textContent = formatCurrency(balance);
    document.getElementById('total-income').textContent = formatCurrency(income);
    document.getElementById('total-expenses').textContent = formatCurrency(expenses);
}

function renderTransactions(transactions) {
    transactionListElement.innerHTML = '';
    const emptyState = document.getElementById('empty-state');

    if (transactions.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('hidden');

    transactions.forEach(tx => {
        const isIncome = tx.type === 'income';
        const amountFormatted = formatCurrency(Math.abs(tx.amount));
        const amountColor = isIncome ? 'text-emerald-600' : 'text-rose-500';
        const sign = isIncome ? '+' : '-';

        const dateFormatted = new Intl.DateTimeFormat('en-IN', { month: 'short', day: 'numeric', year: 'numeric' }).format(tx.timestamp);

        // Status Badge Logic
        let statusBadge = '';
        if (tx.status === 'Completed') {
            statusBadge = `<span class="flex items-center gap-1.5 text-xs font-bold text-emerald-600"><span class="size-1.5 rounded-full bg-emerald-600"></span> Completed</span>`;
        } else if (tx.status === 'Processing') {
            statusBadge = `<span class="flex items-center gap-1.5 text-xs font-bold text-amber-500"><span class="size-1.5 rounded-full bg-amber-500"></span> Processing</span>`;
        } else {
            statusBadge = `<span class="text-xs font-bold text-slate-400">${tx.status}</span>`;
        }

        const iconBg = isIncome ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600';
        const icon = isIncome ? 'trending_up' : 'trending_down';

        // Category Badge
        const categoryBadge = `<span class="text-xs font-medium bg-primary/5 text-primary px-2.5 py-1 rounded-full border border-primary/10">${tx.category}</span>`;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-primary/5 transition-colors group";
        tr.innerHTML = `
            <td class="px-6 py-4">
                <div class="flex items-center gap-3">
                     <div class="size-9 rounded-full ${iconBg} flex items-center justify-center">
                        <span class="material-symbols-outlined text-[18px]">${icon}</span>
                    </div>
                    <div>
                        <p class="text-sm font-bold text-primary">${tx.description}</p>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">${categoryBadge}</td>
            <td class="px-6 py-4 text-sm text-primary/60 font-medium">${dateFormatted}</td>
            <td class="px-6 py-4">${statusBadge}</td>
            <td class="px-6 py-4 text-right font-bold ${amountColor}">${sign}${amountFormatted}</td>
             <td class="px-6 py-4 text-right">
                <button class="delete-btn text-gray-300 hover:text-rose-500 transition-colors" data-id="${tx.id}">
                    <span class="material-symbols-outlined text-lg">delete</span>
                </button>
            </td>
        `;

        tr.querySelector('.delete-btn').addEventListener('click', (e) => {
            // stop propagation if clicking row opens details vs delete
            e.stopPropagation();
            deleteTransaction(tx.id);
        });

        transactionListElement.appendChild(tr);
    });
}

function renderPieChart(totalIncome, totalExpenses) {
    // Reuse existing chart logic but adapted to new size
    const data = [
        { label: 'Income', value: totalIncome, color: '#10b981' },
        { label: 'Expense', value: totalExpenses, color: '#f43f5e' }
    ];

    const total = totalIncome + totalExpenses;
    const displayData = data.filter(d => d.value > 0);
    const container = document.getElementById('pie-chart');
    container.innerHTML = '';
    const legendContainer = document.getElementById('chart-legend');
    if (legendContainer) legendContainer.innerHTML = '';

    if (total === 0 || displayData.length === 0) {
        container.innerHTML = '<div class="text-primary/40 text-sm">No data yet</div>';
        return;
    }

    const size = 250;
    const radius = size / 2;

    const svg = d3.select("#pie-chart")
        .append("svg")
        .attr("viewBox", `0 0 ${size} ${size}`)
        .style("max-width", "250px")
        .append("g")
        .attr("transform", `translate(${size / 2}, ${size / 2})`);

    const pie = d3.pie().value(d => d.value).sort(null);
    const arc = d3.arc().innerRadius(radius * 0.6).outerRadius(radius);

    svg.selectAll(".arc")
        .data(pie(displayData))
        .enter()
        .append("path")
        .attr("d", arc)
        .attr("fill", d => d.data.color)
        .attr("stroke", "white")
        .style("stroke-width", "2px");

    // Start with static center text (Net)
    svg.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.3em")
        .attr("class", "text-sm font-bold fill-current text-primary")
        .text("Net");

    // Add legend
    if (legendContainer) {
        displayData.forEach(d => {
            const item = document.createElement('div');
            item.className = "flex items-center justify-between text-sm";
            item.innerHTML = `
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full" style="background-color: ${d.color}"></span>
                    <span class="text-primary/70">${d.label}</span>
                </div>
                <span class="font-bold text-primary">${formatCurrency(d.value)}</span>
            `;
            legendContainer.appendChild(item);
        });
    }
}

// Theme Logic
function initializeTheme() {
    const storedTheme = localStorage.getItem('theme');
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (storedTheme === 'dark' || (!storedTheme && systemDark)) {
        document.documentElement.classList.add('dark');
        updateThemeIcon(true);
    } else {
        document.documentElement.classList.remove('dark');
        updateThemeIcon(false);
    }
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcon(isDark);
}

function updateThemeIcon(isDark) {
    if (!themeToggleBtn) return;
    const iconSpan = themeToggleBtn.querySelector('span');
    if (iconSpan) {
        iconSpan.textContent = isDark ? 'light_mode' : 'dark_mode';
    }
}

// Event Listeners
if (googleLoginBtn) googleLoginBtn.addEventListener('click', loginWithGoogle);
if (logoutBtn) logoutBtn.addEventListener('click', logout);
if (quickAddBtn) quickAddBtn.addEventListener('click', openModal);
if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);
if (modalTypeExpense) modalTypeExpense.addEventListener('click', () => setModalType('expense'));
if (modalTypeIncome) modalTypeIncome.addEventListener('click', () => setModalType('income'));
if (saveTransactionBtn) saveTransactionBtn.addEventListener('click', startAddTransaction);
if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);

// Init
initializeTheme();
initializeFirebase();
