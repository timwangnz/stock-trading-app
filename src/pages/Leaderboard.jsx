/**
 * Leaderboard.jsx
 * Ranked leaderboard across three scopes: My Class, State, and National.
 * Ranked by % return from each student's base value (recorded at class join).
 */

import { useState, useEffect } from 'react'
import { Trophy, Medal, Loader2, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react'
import {
  fetchMyClasses, fetchClassLeaderboard,
  fetchStateLeaderboard, fetchNationalLeaderboard,
} from '../services/apiService'
import { useApp } from '../context/AppContext'
import clsx from 'clsx'

const TAB_CLASS    = 'class'
const TAB_STATE    = 'state'
const TAB_NATIONAL = 'national'

const fmt    = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const fmtPct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`

function RankBadge({ rank }) {
  if (rank === 1) return <span className="text-yellow-400 text-lg">🥇</span>
  if (rank === 2) return <span className="text-gray-300 text-lg">🥈</span>
  if (rank === 3) return <span className="text-amber-600 text-lg">🥉</span>
  return <span className="text-muted text-sm font-mono w-6 text-center">{rank}</span>
}

function LeaderboardTable({ rows, currentUserId, showSchool }) {
  if (!rows.length) return (
    <div className="text-center py-12 text-muted text-sm">No rankings yet — students need to join a class first.</div>
  )

  return (
    <div className="bg-surface-card border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-muted text-xs">
            <th className="text-center px-4 py-3 w-12">Rank</th>
            <th className="text-left px-4 py-3">Student</th>
            {showSchool && <th className="text-left px-4 py-3 hidden md:table-cell">School</th>}
            <th className="text-right px-4 py-3">Return</th>
            <th className="text-right px-4 py-3 hidden sm:table-cell">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const isMe = r.user_id === currentUserId
            return (
              <tr key={r.user_id}
                className={clsx(
                  'transition-colors',
                  isMe ? 'bg-accent-blue/5 border-l-2 border-l-accent-blue' : 'hover:bg-surface-hover'
                )}>
                <td className="px-4 py-3 text-center">
                  <RankBadge rank={r.rank} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {r.avatar_url
                      ? <img src={r.avatar_url} className="w-7 h-7 rounded-full object-cover" alt="" />
                      : <div className="w-7 h-7 rounded-full bg-accent-blue/20 flex items-center justify-center text-accent-blue text-xs font-bold">
                          {(r.name || '?')[0].toUpperCase()}
                        </div>
                    }
                    <div>
                      <p className={clsx('font-medium', isMe ? 'text-accent-blue' : 'text-primary')}>
                        {r.name || 'Student'} {isMe && <span className="text-xs text-muted">(you)</span>}
                      </p>
                      {r.class_name && <p className="text-muted text-xs">{r.class_name}</p>}
                    </div>
                  </div>
                </td>
                {showSchool && (
                  <td className="px-4 py-3 text-secondary text-xs hidden md:table-cell">
                    {r.school_name}<br/>
                    <span className="text-muted">{r.state}</span>
                  </td>
                )}
                <td className="px-4 py-3 text-right">
                  <span className={clsx('font-semibold', r.return_pct >= 0 ? 'text-gain' : 'text-loss')}>
                    {fmtPct(r.return_pct)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-secondary hidden sm:table-cell">
                  {fmt(r.current_value)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Leaderboard() {
  const { state }  = useApp()
  const currentUser = state.user

  const [tab,      setTab]      = useState(TAB_CLASS)
  const [classes,  setClasses]  = useState([])
  const [classId,  setClassId]  = useState(null)
  const [rows,     setRows]     = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [myRank,   setMyRank]   = useState(null)

  // Load classes the user belongs to
  useEffect(() => {
    fetchMyClasses()
      .then(cls => {
        setClasses(cls)
        if (cls.length) setClassId(cls[0].class_id ?? cls[0].id)
      })
      .catch(() => {})
  }, [])

  // Load leaderboard when tab or class changes
  useEffect(() => {
    setRows([]); setError(null); setLoading(true)

    const load = async () => {
      try {
        let data = []
        if (tab === TAB_CLASS && classId) {
          data = await fetchClassLeaderboard(classId)
        } else if (tab === TAB_STATE) {
          const cls = classes.find(c => (c.class_id ?? c.id) === classId)
          if (cls?.state) data = await fetchStateLeaderboard(cls.state)
        } else if (tab === TAB_NATIONAL) {
          data = await fetchNationalLeaderboard()
        }
        setRows(data)
        const me = data.find(r => r.user_id === currentUser?.id)
        setMyRank(me?.rank ?? null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [tab, classId, currentUser?.id])

  const TABS = [
    { key: TAB_CLASS,    label: 'My Class'  },
    { key: TAB_STATE,    label: 'State'     },
    { key: TAB_NATIONAL, label: 'National'  },
  ]

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-primary font-semibold text-xl flex items-center gap-2">
            <Trophy size={22} className="text-yellow-400" /> Leaderboard
          </h1>
          <p className="text-muted text-sm mt-1">Ranked by % return since joining your class</p>
        </div>
        {myRank && (
          <div className="bg-accent-blue/10 border border-accent-blue/30 rounded-xl px-4 py-2 text-center">
            <p className="text-accent-blue font-bold text-xl">#{myRank}</p>
            <p className="text-muted text-xs">Your rank</p>
          </div>
        )}
      </div>

      {/* Class selector (class tab only) */}
      {tab === TAB_CLASS && classes.length > 1 && (
        <select
          value={classId ?? ''}
          onChange={e => setClassId(Number(e.target.value))}
          className="bg-surface-hover border border-border rounded-lg px-3 py-2 text-primary text-sm focus:outline-none focus:border-accent-blue">
          {classes.map(c => (
            <option key={c.class_id ?? c.id} value={c.class_id ?? c.id}>{c.name}</option>
          ))}
        </select>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-hover border border-border rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={clsx('px-4 py-1.5 rounded-md text-sm font-medium transition-colors',
              tab === t.key ? 'bg-accent-blue text-white' : 'text-muted hover:text-primary')}>
            {t.label}
          </button>
        ))}
      </div>

      {/* No class warning */}
      {tab === TAB_CLASS && !classId && !loading && (
        <div className="text-center py-12 space-y-2">
          <Trophy size={36} className="text-muted mx-auto" />
          <p className="text-primary font-medium">You're not in a class yet</p>
          <p className="text-muted text-sm">Ask your teacher to send you an invite link to join a class.</p>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-loss text-sm bg-loss/10 border border-loss/20 rounded-xl px-4 py-3">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 size={24} className="animate-spin text-muted" />
        </div>
      )}

      {!loading && (tab !== TAB_CLASS || classId) && (
        <LeaderboardTable
          rows={rows}
          currentUserId={currentUser?.id}
          showSchool={tab !== TAB_CLASS}
        />
      )}
    </div>
  )
}
