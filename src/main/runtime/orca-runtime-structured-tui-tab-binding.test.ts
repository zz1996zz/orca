import { describe, expect, it, vi } from 'vitest'
import type { StructuredAgentSessionHandoffTransport } from '../native-chat/agent-session-wire/structured-agent-session-handoff-types'
import { OrcaRuntimeService } from './orca-runtime'

const readStructuredTuiProcessIdentity = vi.hoisted(() => vi.fn())

vi.mock('./structured-tui-process-identity', () => ({ readStructuredTuiProcessIdentity }))

const WORKTREE_ID = 'repo-1::/tmp/structured-handoff'

function notifier(revealTerminalSession: ReturnType<typeof vi.fn>) {
  return {
    worktreesChanged: vi.fn(),
    reposChanged: vi.fn(),
    activateWorktree: vi.fn(),
    createTerminal: vi.fn(),
    revealTerminalSession,
    splitTerminal: vi.fn(),
    renameTerminal: vi.fn(),
    focusTerminal: vi.fn(),
    closeTerminal: vi.fn(),
    sleepWorktree: vi.fn(),
    terminalFitOverrideChanged: vi.fn(),
    terminalDriverChanged: vi.fn()
  }
}

describe('structured TUI launch tab binding', () => {
  it('publishes and reveals the launch tab before rollout proof', async () => {
    const revealTerminalSession = vi.fn((_worktreeId: string, options: { tabId?: string }) =>
      Promise.resolve({ tabId: options.tabId! })
    )
    const runtime = new OrcaRuntimeService({
      getSettings: () => ({
        disabledTuiAgents: [],
        agentCmdOverrides: {},
        agentDefaultArgs: {},
        agentDefaultEnv: {}
      })
    } as never)
    runtime.setNotifier(notifier(revealTerminalSession) as never)
    runtime.setPtyController({
      spawn: vi.fn().mockResolvedValue({ id: 'pty-structured', pid: 4242 }),
      write: () => true,
      kill: () => true,
      getForegroundProcess: async () => null
    })

    const internal = runtime as unknown as {
      createStructuredAgentSessionHandoffTransport(): StructuredAgentSessionHandoffTransport
      resolveTerminalWorkspaceLaunchScope(): Promise<{
        id: string
        path: string
        connectionId: null
        repo: null
        folderWorkspace: null
      }>
      markLocalWorkspaceTrustedForAgent(): void
      waitForStructuredTuiProof(): Promise<{ transcriptPath?: string }>
    }
    internal.resolveTerminalWorkspaceLaunchScope = vi.fn(async () => ({
      id: WORKTREE_ID,
      path: '/tmp/structured-handoff',
      connectionId: null,
      repo: null,
      folderWorkspace: null
    }))
    internal.markLocalWorkspaceTrustedForAgent = vi.fn()
    internal.waitForStructuredTuiProof = vi.fn(async () => {
      const reveal = revealTerminalSession.mock.calls[0]?.[1] as
        | { tabId?: string; leafId?: string; ptyId?: string }
        | undefined
      const snapshot = await runtime.listMobileSessionTabs(`id:${WORKTREE_ID}`)
      expect(snapshot.tabs).toContainEqual(
        expect.objectContaining({
          type: 'terminal',
          parentTabId: reveal?.tabId,
          leafId: reveal?.leafId,
          terminal: expect.any(String)
        })
      )
      expect(revealTerminalSession).toHaveBeenCalledWith(
        WORKTREE_ID,
        expect.objectContaining({
          ptyId: 'pty-structured',
          tabId: expect.any(String),
          leafId: expect.any(String)
        })
      )
      return { transcriptPath: '/tmp/rollout.jsonl' }
    })
    readStructuredTuiProcessIdentity.mockResolvedValue({
      hostId: 'local',
      pid: 4243,
      processStartTimeMs: 10,
      spawnToken: 'spawn-token'
    })

    const transport = internal.createStructuredAgentSessionHandoffTransport()
    const owner = await transport.launchTui({
      record: {
        sessionId: 'session-1',
        location: { workspaceId: WORKTREE_ID, executionHostId: 'local' },
        accountHome: { variable: 'CODEX_HOME', path: '/tmp/codex-home' },
        providerHandleChain: [
          { handle: { provider: 'codex', threadId: 'thread-1' }, observedAt: 1 }
        ]
      } as never,
      fence: 3,
      spawnToken: 'spawn-token'
    })

    const reveal = revealTerminalSession.mock.calls[0]?.[1] as {
      tabId: string
      leafId: string
    }
    expect(owner.terminal).toMatchObject({
      tabId: reveal.tabId,
      paneKey: `${reveal.tabId}:${reveal.leafId}`
    })
    expect(internal.waitForStructuredTuiProof).toHaveBeenCalledOnce()
  })
})
