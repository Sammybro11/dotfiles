export PKG_CONFIG_PATH="/opt/homebrew/lib/pkgconfig:/opt/homebrew/opt/libffi/lib/pkgconfig:$PKG_CONFIG_PATH"
export LDFLAGS="-L/opt/homebrew/lib -L/opt/homebrew/opt/libffi/lib"
export CPPFLAGS="-I/opt/homebrew/include -I/opt/homebrew/opt/libffi/include"

CASE_SENSITIVE="false"
ENABLE_CORRECTION="true"

eval "$(starship init zsh)"
eval "$(zoxide init --cmd cd --hook prompt zsh)"
export EDITOR=nvim
export VISUAL=nvim

activate() {
    source .venv/bin/activate
    which python3
}
# alias activate="source .venv/bin/activate"
alias pyrun="python3 main.py"
alias pokefetch="pokeget random --hide-name | fastfetch --file-raw -"
alias ll="ls -la"

spf() {
    os=$(uname -s)

    # Linux
    if [[ "$os" == "Linux" ]]; then
        export SPF_LAST_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/superfile/lastdir"
    fi

    # macOS
    if [[ "$os" == "Darwin" ]]; then
        export SPF_LAST_DIR="$HOME/Library/Application Support/superfile/lastdir"
    fi

    command spf "$@"

    [ ! -f "$SPF_LAST_DIR" ] || {
        . "$SPF_LAST_DIR"
        rm -f -- "$SPF_LAST_DIR" > /dev/null
    }
}

# Dotfiles alias
alias dotfiles="/usr/bin/git --git-dir=$HOME/.dotfiles --work-tree=$HOME"


# export PYENV_ROOT="$HOME/.pyenv"
# export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init -)"

# >>> juliaup initialize >>>

# !! Contents within this block are managed by juliaup !!

path=('/Users/samyakrai/.juliaup/bin' $path)
export PATH

# <<< juliaup initialize <<<
