const DB_NAME = "ReviewSnifferDB";
const DB_VERSION = 1;
const PROCESSES_STORE = "processes";
const REVIEWS_STORE = "reviews";

/**
 * Opens the IndexedDB database and creates the necessary object stores
 * and indexes if they do not already exist.
 * @returns {Promise<IDBDatabase>} resolves with the opened database,
 * rejects with an error if any occur
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(PROCESSES_STORE)) {
        const processStore = db.createObjectStore(PROCESSES_STORE, { keyPath: "processId" });
        processStore.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains(REVIEWS_STORE)) {
        const reviewStore = db.createObjectStore(REVIEWS_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        reviewStore.createIndex("processId", "processId", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves a process object to the IndexedDB store.
 * @param {Object} process - process object to save
 * @returns {Promise} resolves when the process has been saved, rejects with an error if any occur
 */
export async function saveProcess(process) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROCESSES_STORE, "readwrite");
    tx.objectStore(PROCESSES_STORE).put(process);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves a process object from the IndexedDB store by its process ID.
 * @param {string} processId - process ID to retrieve
 * @returns {Promise<Object>} resolves with the process object, rejects with an error if any occur
 */
export async function getProcess(processId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROCESSES_STORE, "readonly");
    const req = tx.objectStore(PROCESSES_STORE).get(processId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves all processes from the IndexedDB store.
 * @returns {Promise<Array<Object>>} resolves with an array of process objects
 */
export async function getAllProcesses() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PROCESSES_STORE, "readonly");
    const req = tx.objectStore(PROCESSES_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Deletes a process with the given process ID and all associated reviews.
 * @param {string} processId - process ID to delete
 * @returns {Promise} resolves when the deletion is complete, rejects with an error if any occur
 */
export async function deleteProcess(processId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([PROCESSES_STORE, REVIEWS_STORE], "readwrite");

    tx.objectStore(PROCESSES_STORE).delete(processId);

    const reviewStore = tx.objectStore(REVIEWS_STORE);
    const index = reviewStore.index("processId");
    const req = index.openCursor(IDBKeyRange.only(processId));
    req.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Saves an array of reviews to the IndexedDB store.
 * @param {Array<Object>} reviews - array of review objects to save
 * @returns {Promise} resolves when all reviews have been saved, rejects with an error if any occur
 */
export async function saveReviews(reviews) {
  if (!reviews.length) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REVIEWS_STORE, "readwrite");
    const store = tx.objectStore(REVIEWS_STORE);
    reviews.forEach((r) => store.add(r));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Retrieves all reviews associated with a given process ID.
 * @param {string} processId - process ID to retrieve reviews for
 * @returns {Promise<Review[]>} - resolves with an array of reviews
 */
export async function getReviewsByProcess(processId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REVIEWS_STORE, "readonly");
    const index = tx.objectStore(REVIEWS_STORE).index("processId");
    const req = index.getAll(IDBKeyRange.only(processId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
