function createAuthAccounts(schoolUsers = []) {
  return schoolUsers.reduce((accounts, user) => {
    if (!user?.login) return accounts;
    const fallbackId = user.id || user.userId || `student_${user.login}`;
    accounts.push({
      role: "student",
      ...user,
      id: fallbackId,
      userId: user.userId || user.id || fallbackId,
    });
    return accounts;
  }, []);
}

function findAccountByCredentials(accounts, login, password) {
  return accounts.find((account) => account.login === login && account.password === password) || null;
}

function findAccountByInviteCode(accounts, inviteCode) {
  const normalizedInviteCode = normalizeInviteCode(inviteCode);
  if (!normalizedInviteCode) return null;
  return accounts.find((account) => normalizeInviteCode(account.inviteCode) === normalizedInviteCode) || null;
}

function normalizeInviteCode(inviteCode) {
  return String(inviteCode || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export { createAuthAccounts, findAccountByCredentials, findAccountByInviteCode, normalizeInviteCode };
