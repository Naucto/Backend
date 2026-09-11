let SessionLoad = 1
let s:so_save = &g:so | let s:siso_save = &g:siso | setg so=0 siso=0 | setl so=-1 siso=-1
let v:this_session=expand("<sfile>:p")
silent only
silent tabonly
cd ~/Documents/Projets/Naucto/Backend
if expand('%') == '' && !&modified && line('$') <= 1 && getline(1) == ''
  let s:wipebuf = bufnr('%')
endif
let s:shortmess_save = &shortmess
if &shortmess =~ 'A'
  set shortmess=aoOA
else
  set shortmess=aoO
endif
badd +1348 term://~/Documents/Projets/Naucto/Backend//12954:/usr/bin/zsh
badd +7429 term://~/Documents/Projets/Naucto/Backend//13976:/usr/bin/zsh
badd +789 term://~/Documents/Projets/Naucto/Backend//14167:/usr/bin/zsh
badd +362 src/routes/project/project.controller.ts
badd +1 src/routes/project/project.service.ts
badd +32 src/routes/s3/s3.error.ts
badd +156 src/routes/work-session/work-session.service.ts
badd +13 prisma/models/session.prisma
badd +1 prisma/migrations/20260406040636_refactor_last_active_at_field/migration.sql
argglobal
%argdel
edit prisma/migrations/20260406040636_refactor_last_active_at_field/migration.sql
let s:save_splitbelow = &splitbelow
let s:save_splitright = &splitright
set splitbelow splitright
wincmd _ | wincmd |
vsplit
wincmd _ | wincmd |
vsplit
2wincmd h
wincmd w
wincmd w
wincmd _ | wincmd |
split
wincmd _ | wincmd |
split
2wincmd k
wincmd w
wincmd w
let &splitbelow = s:save_splitbelow
let &splitright = s:save_splitright
wincmd t
let s:save_winminheight = &winminheight
let s:save_winminwidth = &winminwidth
set winminheight=0
set winheight=1
set winminwidth=0
set winwidth=1
exe 'vert 1resize ' . ((&columns * 106 + 159) / 318)
exe 'vert 2resize ' . ((&columns * 105 + 159) / 318)
exe '3resize ' . ((&lines * 32 + 51) / 102)
exe 'vert 3resize ' . ((&columns * 105 + 159) / 318)
exe '4resize ' . ((&lines * 33 + 51) / 102)
exe 'vert 4resize ' . ((&columns * 105 + 159) / 318)
exe '5resize ' . ((&lines * 32 + 51) / 102)
exe 'vert 5resize ' . ((&columns * 105 + 159) / 318)
argglobal
enew
file \[CodeCompanion]\ 486
balt prisma/migrations/20260406040636_refactor_last_active_at_field/migration.sql
setlocal foldmethod=manual
setlocal foldexpr=0
setlocal foldmarker={{{,}}}
setlocal foldignore=#
setlocal foldlevel=0
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldenable
wincmd w
argglobal
setlocal foldmethod=manual
setlocal foldexpr=0
setlocal foldmarker={{{,}}}
setlocal foldignore=#
setlocal foldlevel=0
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldenable
silent! normal! zE
let &fdl = &fdl
let s:l = 12 - ((11 * winheight(0) + 49) / 99)
if s:l < 1 | let s:l = 1 | endif
keepjumps exe s:l
normal! zt
keepjumps 12
normal! 07|
wincmd w
argglobal
if bufexists(fnamemodify("term://~/Documents/Projets/Naucto/Backend//14167:/usr/bin/zsh", ":p")) | buffer term://~/Documents/Projets/Naucto/Backend//14167:/usr/bin/zsh | else | edit term://~/Documents/Projets/Naucto/Backend//14167:/usr/bin/zsh | endif
if &buftype ==# 'terminal'
  silent file term://~/Documents/Projets/Naucto/Backend//14167:/usr/bin/zsh
endif
balt term://~/Documents/Projets/Naucto/Backend//13976:/usr/bin/zsh
setlocal foldmethod=manual
setlocal foldexpr=0
setlocal foldmarker={{{,}}}
setlocal foldignore=#
setlocal foldlevel=0
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldenable
let s:l = 786 - ((28 * winheight(0) + 16) / 32)
if s:l < 1 | let s:l = 1 | endif
keepjumps exe s:l
normal! zt
keepjumps 786
normal! 051|
wincmd w
argglobal
if bufexists(fnamemodify("term://~/Documents/Projets/Naucto/Backend//13976:/usr/bin/zsh", ":p")) | buffer term://~/Documents/Projets/Naucto/Backend//13976:/usr/bin/zsh | else | edit term://~/Documents/Projets/Naucto/Backend//13976:/usr/bin/zsh | endif
if &buftype ==# 'terminal'
  silent file term://~/Documents/Projets/Naucto/Backend//13976:/usr/bin/zsh
endif
balt term://~/Documents/Projets/Naucto/Backend//12954:/usr/bin/zsh
setlocal foldmethod=manual
setlocal foldexpr=0
setlocal foldmarker={{{,}}}
setlocal foldignore=#
setlocal foldlevel=0
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldenable
let s:l = 7429 - ((32 * winheight(0) + 16) / 33)
if s:l < 1 | let s:l = 1 | endif
keepjumps exe s:l
normal! zt
keepjumps 7429
normal! 0
wincmd w
argglobal
if bufexists(fnamemodify("term://~/Documents/Projets/Naucto/Backend//12954:/usr/bin/zsh", ":p")) | buffer term://~/Documents/Projets/Naucto/Backend//12954:/usr/bin/zsh | else | edit term://~/Documents/Projets/Naucto/Backend//12954:/usr/bin/zsh | endif
if &buftype ==# 'terminal'
  silent file term://~/Documents/Projets/Naucto/Backend//12954:/usr/bin/zsh
endif
setlocal foldmethod=manual
setlocal foldexpr=0
setlocal foldmarker={{{,}}}
setlocal foldignore=#
setlocal foldlevel=0
setlocal foldminlines=1
setlocal foldnestmax=20
setlocal foldenable
let s:l = 1348 - ((31 * winheight(0) + 16) / 32)
if s:l < 1 | let s:l = 1 | endif
keepjumps exe s:l
normal! zt
keepjumps 1348
normal! 02|
wincmd w
exe 'vert 1resize ' . ((&columns * 106 + 159) / 318)
exe 'vert 2resize ' . ((&columns * 105 + 159) / 318)
exe '3resize ' . ((&lines * 32 + 51) / 102)
exe 'vert 3resize ' . ((&columns * 105 + 159) / 318)
exe '4resize ' . ((&lines * 33 + 51) / 102)
exe 'vert 4resize ' . ((&columns * 105 + 159) / 318)
exe '5resize ' . ((&lines * 32 + 51) / 102)
exe 'vert 5resize ' . ((&columns * 105 + 159) / 318)
tabnext 1
if exists('s:wipebuf') && len(win_findbuf(s:wipebuf)) == 0 && getbufvar(s:wipebuf, '&buftype') isnot# 'terminal'
  silent exe 'bwipe ' . s:wipebuf
endif
unlet! s:wipebuf
set winheight=1 winwidth=20
let &shortmess = s:shortmess_save
let &winminheight = s:save_winminheight
let &winminwidth = s:save_winminwidth
let s:sx = expand("<sfile>:p:r")."x.vim"
if filereadable(s:sx)
  exe "source " . fnameescape(s:sx)
endif
let &g:so = s:so_save | let &g:siso = s:siso_save
set hlsearch
doautoall SessionLoadPost
unlet SessionLoad
" vim: set ft=vim :
