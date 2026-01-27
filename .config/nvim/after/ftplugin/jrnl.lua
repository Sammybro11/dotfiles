vim.api.nvim_create_autocmd({ 'BufNewFile', 'BufReadPre' }, {
    group = vim.api.nvim_create_augroup('PrivateJrnl', {}),
    pattern = '*.jrnl',
    callback = function()
        vim.opt_local.swapfile = false
        vim.opt_local.undofile = false
        vim.opt_local.backup = false
        vim.opt_local.writebackup = false
        vim.opt_local.shelltemp = false
        vim.opt_local.modeline = false

        vim.opt.shada = ''
        vim.opt.history = 0
        vim.opt.secure = true
    end,
})
