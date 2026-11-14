. "$PSScriptRoot\env.ps1"
# Wasm builds link their host build scripts with Rust's own bundled linker, so hide the kit's gcc.
$env:Path = ($env:Path -split ';' | Where-Object { $_ -and $_ -notlike '*\w64devkit\*' }) -join ';'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS = $null
