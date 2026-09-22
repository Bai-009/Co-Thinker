import type { Epistemic } from '../../domain/types'

export interface ScriptClaim {
  text: string
  status: Epistemic
  /** 依据的消息 sequence。 */
  from: number[]
  supersedes?: string
}

export interface ScriptGroundwork {
  prose: string
  claims: ScriptClaim[]
  open: string[]
  /** 示例里手写的感觉值。 */
  sense?: { certainty: number; resonance: number; clarity: number }
}

export interface ScriptStep {
  /** 这一步期待的输入。 */
  input: string
  voice: string
  /** 这一轮回应的把握，示例里是手写的。 */
  confidence?: number
  groundwork: ScriptGroundwork
}

export interface Topic {
  key: string
  title: string
  steps: ScriptStep[]
}
