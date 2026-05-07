import { useCallback, useEffect, useState } from 'react'

import { API, getJSON } from '../lib/api'
import { sessionedFetch, getSessionId, setSessionId, clearSessionId } from '../lib/session'

// Conversation list + current id, used by the sidebar.
//
// Model:
//   - `list` is the server's list of all sessions (newest first).
//   - `currentId` mirrors the localStorage session id. We track it as
//     React state so changes can drive a re-hydration of the main view.
//   - "New conversation" clears the localStorage id and sets currentId
//     to ''. The next workshop turn calls the server with no header,
//     server mints a fresh id and `sessionedFetch` writes it back to
//     localStorage. The parent should call `refresh()` after a turn
//     completes so the list and currentId resync.
//   - "Switch to" writes the chosen id to localStorage and updates
//     currentId. The parent's hydration effect re-runs and pulls that
//     conversation's history/foundation/etc.
//   - "Remove" deletes server-side; if it was the current one, drops to
//     a fresh "new conversation" state.

export default function useConversations() {
  const [list, setList] = useState([])
  const [currentId, setCurrentId] = useState(() => getSessionId())

  const refresh = useCallback(async () => {
    try {
      const data = await getJSON(API.sessions)
      setList(Array.isArray(data?.sessions) ? data.sessions : [])
    } catch {
      // Soft-fail — sidebar is decorative; an empty list is fine.
    }
    setCurrentId(getSessionId())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const newConversation = useCallback(() => {
    clearSessionId()
    setCurrentId('')
  }, [])

  const switchTo = useCallback((id) => {
    if (!id || id === getSessionId()) return
    setSessionId(id)
    setCurrentId(id)
  }, [])

  const remove = useCallback(
    async (id) => {
      if (!id) return
      try {
        await sessionedFetch(API.sessionDelete(id), { method: 'DELETE' })
      } catch {
        // Soft-fail — refresh will tell us the truth.
      }
      if (id === getSessionId()) {
        clearSessionId()
        setCurrentId('')
      }
      await refresh()
    },
    [refresh],
  )

  return { list, currentId, refresh, newConversation, switchTo, remove }
}
