vim.api.nvim_create_user_command("PackAdd", function(opts)
    vim.pack.add(opts.fargs)
end, { nargs = "+", desc = "Add plugins (:PackAdd user/repo1 user/repo2)" })

-- Pack Delete and Update cmds are built-in on Nightly 0.13
vim.api.nvim_create_user_command("PackDel", function(opts)
    vim.pack.del(opts.fargs)
end, { nargs = "+", desc = "Delete plugins (:PackDel plugin1 plugin2)" })

vim.api.nvim_create_user_command("PackUpdate", function(opts)
	-- checks if any argument is passed
    if opts.args:match("%S") then
        -- update specific plugins
        local plugins = vim.split(opts.args, "%s+", { trimempty = true })
		-- update only specified plugins
        vim.pack.update(plugins)
    else
        -- update all
        vim.pack.update()
    end
end, { nargs = "*", desc = "Update all plugins or specific ones" })

-- Journal Autocmd
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
