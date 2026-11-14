# Build environment for this Windows machine: Rust (gnu host) plus portable Node, git and NEAR tools.
# Dot-source it:  . .\tools\env.ps1     Use envw.ps1 instead when building the wasm.
$root = Join-Path $env:LOCALAPPDATA 'Programs\near-dev'
$clean = ($env:Path -split ';' | Where-Object { $_ -and $_ -notlike '*\MinGW\*' -and $_ -notlike '*\near-dev\*' }) -join ';'
$env:Path = "$env:USERPROFILE\.cargo\bin;$root\w64devkit\bin;$root\node-v26.13.0-win-x64;$root\mingit\cmd;$root\near-cli\near-cli-rs-x86_64-pc-windows-msvc;$root\cargo-near\cargo-near-x86_64-pc-windows-msvc;$clean"
$env:CARGO_TERM_COLOR = 'never'
$env:CARGO_TARGET_DIR = "$env:LOCALAPPDATA\sqk"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS = "-L native=$root\stub"
$env:AWS_LC_SYS_PREBUILT_NASM = "1"
