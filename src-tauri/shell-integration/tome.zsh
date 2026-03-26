# Tome Shell Integration for Zsh
# Injects OSC 133 markers for Block mode

# Only load if running inside Tome
[[ "$TERM_PROGRAM" == "tome" ]] || return 0

# Disable PROMPT_SP (the % marker for partial lines) — it outputs before precmd
# and pollutes block output
setopt no_prompt_sp

__tome_emit_cwd() {
    local encoded_pwd
    encoded_pwd=$(printf '%s' "$PWD" | base64 | tr -d '\n')
    printf '\e]633;P;%s\a' "$encoded_pwd"
}

__tome_precmd() {
    local exit_code=$?
    # Command finished marker (with exit code)
    printf '\e]133;D;%s\a' "$exit_code"
    # Prompt start marker
    printf '\e]133;A\a'
    __tome_emit_cwd
    # Input start marker
    printf '\e]133;B\a'
}

__tome_preexec() {
    # Input end / command start marker
    printf '\e]133;C\a'
}

# Send initial prompt marker
printf '\e]133;A\a'
__tome_emit_cwd
printf '\e]133;B\a'

# Register hooks
precmd_functions=(__tome_precmd $precmd_functions)
preexec_functions=(__tome_preexec $preexec_functions)
