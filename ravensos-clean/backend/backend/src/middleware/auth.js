// Bearer-token auth. For the MVP a token is minted at register time. In
// production this becomes phone-OTP -> short-lived JWT; the guard stays the same.
export function authMiddleware(store) {
  return (req, res, next) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? store.getUserByToken(token) : null;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    req.user = user;
    next();
  };
}
