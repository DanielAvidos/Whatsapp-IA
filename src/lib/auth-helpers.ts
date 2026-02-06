
import { User } from "firebase/auth";
import { collection, query, where, getDocs, Firestore } from "firebase/firestore";

export const SUPERADMIN_EMAIL = "superadmin@avidos.com";
export const ADMIN_EMAILS = [SUPERADMIN_EMAIL];

/**
 * Checks if the current user is a Superadmin.
 */
export function getIsSuperAdmin(user: User | null | { email: string | null }): boolean {
  if (!user?.email) return false;
  const email = user.email.toLowerCase();
  return ADMIN_EMAILS.some(adminEmail => adminEmail.toLowerCase() === email);
}

/**
 * Resolves the company associated with a client administrator.
 */
export async function getMyCompany(db: Firestore, user: User | null) {
  if (!user || getIsSuperAdmin(user)) return null;

  const companiesRef = collection(db, "companies");

  // Attempt 1: Match by adminUid
  let q = query(companiesRef, where("adminUid", "==", user.uid));
  let snap = await getDocs(q);

  if (!snap.empty) {
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  // Attempt 2: Match by adminEmail (fallback)
  if (user.email) {
    q = query(companiesRef, where("adminEmail", "==", user.email));
    snap = await getDocs(q);
    if (!snap.empty) {
      return { id: snap.docs[0].id, ...snap.docs[0].data() };
    }
  }

  return null;
}
