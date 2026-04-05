const RAW_OUTPUT_BUFFER_LIMIT = 1024 * 1024;
const RAW_OUTPUT_BUFFER_TRIM_TARGET = 768 * 1024;
const FULLSCREEN_REPLAY_BUFFER_LIMIT = 256 * 1024;
const FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET = 192 * 1024;

export interface RawOutputBufferState {
  rawOutput: string;
  rawOutputBaseOffset: number;
}

export interface RawOutputBufferBudget {
  limit: number;
  trimTarget: number;
}

export interface AppendedRawOutputBuffer extends RawOutputBufferState {
  didTrim: boolean;
  trimmedCharCount: number;
}

const DEFAULT_RAW_OUTPUT_BUFFER_BUDGET: RawOutputBufferBudget = {
  limit: RAW_OUTPUT_BUFFER_LIMIT,
  trimTarget: RAW_OUTPUT_BUFFER_TRIM_TARGET,
};

export function appendRawOutputChunk(
  state: RawOutputBufferState,
  chunk: string,
  budget: RawOutputBufferBudget = DEFAULT_RAW_OUTPUT_BUFFER_BUDGET
): AppendedRawOutputBuffer {
  if (chunk.length === 0) {
    return {
      ...state,
      didTrim: false,
      trimmedCharCount: 0,
    };
  }

  const nextRawOutput = state.rawOutput + chunk;
  if (nextRawOutput.length <= budget.limit) {
    return {
      rawOutput: nextRawOutput,
      rawOutputBaseOffset: state.rawOutputBaseOffset,
      didTrim: false,
      trimmedCharCount: 0,
    };
  }

  const trimStart = nextRawOutput.length - budget.trimTarget;
  return {
    rawOutput: nextRawOutput.slice(trimStart),
    rawOutputBaseOffset: state.rawOutputBaseOffset + trimStart,
    didTrim: true,
    trimmedCharCount: trimStart,
  };
}

export function getRawOutputAbsoluteEnd(state: RawOutputBufferState): number {
  return state.rawOutputBaseOffset + state.rawOutput.length;
}

export {
  FULLSCREEN_REPLAY_BUFFER_LIMIT,
  FULLSCREEN_REPLAY_BUFFER_TRIM_TARGET,
  RAW_OUTPUT_BUFFER_LIMIT,
  RAW_OUTPUT_BUFFER_TRIM_TARGET,
};
