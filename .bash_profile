export PATH="/Library/TeX/texbin:$PATH"

# >>> juliaup initialize >>>

# !! Contents within this block are managed by juliaup !!

case ":$PATH:" in
    *:/Users/samyakrai/.juliaup/bin:*)
        ;;

    *)
        export PATH=/Users/samyakrai/.juliaup/bin${PATH:+:${PATH}}
        ;;
esac
# Tab completion for juliaup and julia channel selection
[ -f "/Users/samyakrai/.julia/juliaup/completions/bash.sh" ] && source "/Users/samyakrai/.julia/juliaup/completions/bash.sh"

# <<< juliaup initialize <<<

export PATH="$HOME/.elan/bin:$PATH"
