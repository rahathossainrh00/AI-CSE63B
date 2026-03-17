// ============================================
// 🔥 FIREBASE CLIENT CONFIGURATION
// ============================================

// ⚠️ REPLACE THESE WITH YOUR OWN FIREBASE CONFIG
// NOTE: These Firebase config values (including apiKey) are safe to include
// in client-side code. They are project identifiers, NOT secret keys.
// Actual data security is enforced by Firestore Security Rules (firestore.rules)
// and Firebase Authentication — not by hiding these values.
const firebaseConfig = {
    apiKey: "AIzaSyDyZ6sLmYW30aRr-WKjs08uE6WhZ6MOOms",
    authDomain: "cse-63b.firebaseapp.com",
    projectId: "cse-63b",
    storageBucket: "cse-63b.firebasestorage.app",
    messagingSenderId: "504990808170",
    appId: "1:504990808170:web:942fb54ca1426d2b927213"
};

// Initialize Firebase
let app, db, auth;

function initFirebase() {
    try {
        app = firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        auth = firebase.auth();
        console.log('Firebase initialized');
        return true;
    } catch (error) {
        console.error('Firebase initialization failed:', error);
        return false;
    }
}

// ============================================
// 🔐 AUTH HELPER FUNCTIONS
// ============================================

async function getCurrentUser() {
    return new Promise((resolve) => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

async function signIn(email, password) {
    try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        return userCredential;
    } catch (error) {
        throw new Error(error.message);
    }
}

async function signOut() {
    try {
        await auth.signOut();
    } catch (error) {
        throw new Error(error.message);
    }
}

function onAuthStateChange(callback) {
    return auth.onAuthStateChanged((user) => {
        if (user) {
            callback('SIGNED_IN', { user });
        } else {
            callback('SIGNED_OUT', null);
        }
    });
}

// ============================================
// 📦 FIRESTORE HELPER FUNCTIONS
// ============================================

// Get all documents from a collection (with optional ordering)
async function getCollection(collectionName, orderByField = null, orderDirection = 'asc') {
    let query = db.collection(collectionName);
    
    if (orderByField) {
        query = query.orderBy(orderByField, orderDirection);
    }
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
    }));
}

// Get a single document by ID
async function getDocument(collectionName, docId) {
    const doc = await db.collection(collectionName).doc(docId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

// Add a new document
async function addDocument(collectionName, data) {
    const docRef = await db.collection(collectionName).add(data);
    return docRef.id;
}

// Update an existing document
async function updateDocument(collectionName, docId, data) {
    await db.collection(collectionName).doc(docId).update(data);
}

// Delete a document
async function deleteDocument(collectionName, docId) {
    await db.collection(collectionName).doc(docId).delete();
}

// Get collection count
// TODO: This fetches ALL documents just to count them, wasting reads/bandwidth.
// Consider using Firestore's countQuery (db.collection(name).count().get())
// or maintaining a server-side counter document.
async function getCollectionCount(collectionName) {
    const snapshot = await db.collection(collectionName).get();
    return snapshot.size;
}
