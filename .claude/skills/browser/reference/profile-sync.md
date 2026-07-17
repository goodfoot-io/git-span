# Profile sync

Start a remote Browser Use browser already logged in, by reusing an existing cloud profile (cookies only — no localStorage/IndexedDB/extensions, so this only helps on session-cookie sites).

```python
list_cloud_profiles()
# [{id, name, userId, cookieDomains, lastUsedAt}, ...] — every profile under this API key

start_remote_daemon("work", profileName="my-work")   # name→id resolved client-side
start_remote_daemon("work", profileId="<uuid>")      # or pass UUID directly

stop_remote_daemon("work")                           # shut the daemon and PATCH the cloud browser to stop — billing ends
```

Cookies are real auth — don't pick a profile unilaterally. List `list_cloud_profiles()` and ask the user which one to reuse (or confirm starting clean) before passing `profileName`/`profileId` to `start_remote_daemon`.

Cookies mutated during a remote session only persist on a clean `stop_remote_daemon` call — sessions that hit the timeout lose in-session state.

Profile names are not unique: `matches = [p["id"] for p in list_cloud_profiles() if p["name"] == "<name>"]` — verify `len(matches) == 1` before trusting a name-based lookup.

## Traps

- Default proxy (`proxyCountryCode="us"`) blocks some destinations with `ERR_TUNNEL_CONNECTION_FAILED` (e.g. `cloud.browser-use.com` itself). Pass `proxyCountryCode=None` to `start_remote_daemon` to disable the BU proxy, or a different country code to pick a different exit.
