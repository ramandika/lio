/** Post-login landing route per role (LOGIN_ARCHITECTURE.md). */
export function roleHome(user) {
  return user.role === 'requestor' ? '/requests/new' : '/requests'
}