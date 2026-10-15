//! Private inherited-pipe protocol for a native parent, independent of CLI text.
use super::ServerError;
use std::{io::Write, net::SocketAddr, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt};

pub struct Parent {
    token: String,
    preferences: Option<crate::settings::NativePreferences>,
    #[cfg(unix)]
    input: tokio::net::unix::pipe::Receiver,
    #[cfg(windows)]
    input: tokio::io::DuplexStream,
}
#[cfg(unix)]
fn parent_input() -> Result<tokio::net::unix::pipe::Receiver, ServerError> {
    use std::os::fd::{FromRawFd, OwnedFd};
    // Own only a duplicate; never close the application's original stdin.
    let fd = unsafe { libc::fcntl(libc::STDIN_FILENO, libc::F_DUPFD_CLOEXEC, 3) };
    if fd < 0 {
        return Err(ServerError::Initialize);
    }
    let fd = unsafe { OwnedFd::from_raw_fd(fd) };
    tokio::net::unix::pipe::Receiver::from_owned_fd(fd).map_err(|_| ServerError::Initialize)
}
#[cfg(windows)]
fn parent_input() -> Result<tokio::io::DuplexStream, ServerError> {
    use std::{
        io::Read,
        os::windows::io::{AsHandle, AsRawHandle},
    };
    use tokio::io::AsyncWriteExt;
    use windows_sys::Win32::Storage::FileSystem::{FILE_TYPE_PIPE, GetFileType};
    // Own only a duplicate; never close the application's original stdin.
    let handle = std::io::stdin()
        .as_handle()
        .try_clone_to_owned()
        .map_err(|_| ServerError::Initialize)?;
    // Matches the Unix FIFO requirement: a console or file is not a parent.
    if unsafe { GetFileType(handle.as_raw_handle()) } != FILE_TYPE_PIPE {
        return Err(ServerError::Initialize);
    }
    let mut pipe = std::fs::File::from(handle);
    // Anonymous pipes cannot join Tokio's reactor. A detached thread performs
    // the blocking reads so a pending read never delays process exit.
    let (input, mut output) = tokio::io::duplex(4096);
    let runtime = tokio::runtime::Handle::current();
    std::thread::Builder::new()
        .name("parent-pipe".into())
        .spawn(move || {
            let mut buffer = [0; 4096];
            while let Ok(read @ 1..) = pipe.read(&mut buffer) {
                if runtime.block_on(output.write_all(&buffer[..read])).is_err() {
                    break;
                }
            }
        })
        .map_err(|_| ServerError::Initialize)?;
    Ok(input)
}
impl Parent {
    pub async fn open() -> Result<Self, ServerError> {
        // Do not silently select between two credentials.
        if std::env::var_os("QUOTIO_SERVER_TOKEN").is_some() {
            return Err(ServerError::Security);
        }
        #[cfg(any(unix, windows))]
        {
            let mut input = parent_input()?;
            let handshake =
                tokio::time::timeout(Duration::from_secs(5), read_handshake(&mut input))
                    .await
                    .map_err(|_| ServerError::Security)??;
            Ok(Self {
                token: handshake.token,
                preferences: handshake.preferences,
                input,
            })
        }
        #[cfg(not(any(unix, windows)))]
        Err(ServerError::Initialize)
    }
    pub fn take_preferences(&mut self) -> Option<crate::settings::NativePreferences> {
        self.preferences.take()
    }
    pub fn take_token(&mut self) -> String {
        std::mem::take(&mut self.token)
    }
    pub async fn closed(&mut self) {
        #[cfg(any(unix, windows))]
        {
            // EOF, read failure, or unexpected extra input ends the parent session.
            let _ = self.input.read_u8().await;
        }
    }
}
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Handshake {
    token: String,
    preferences: Option<crate::settings::NativePreferences>,
}
async fn read_handshake(input: &mut (impl AsyncRead + Unpin)) -> Result<Handshake, ServerError> {
    let mut bytes = Vec::with_capacity(512);
    loop {
        let byte = input.read_u8().await.map_err(|_| ServerError::Security)?;
        if byte == b'\n' {
            let handshake: Handshake =
                serde_json::from_slice(&bytes).map_err(|_| ServerError::Security)?;
            if !(32..=4096).contains(&handshake.token.len())
                || !handshake.token.bytes().all(|byte| byte.is_ascii_graphic())
            {
                return Err(ServerError::Security);
            }
            return Ok(handshake);
        }
        if bytes.len() == 16384 {
            return Err(ServerError::Security);
        }
        bytes.push(byte);
    }
}
pub fn announce(address: SocketAddr) -> Result<(), ServerError> {
    let record = serde_json::json!({
        "bootstrap_version": 2,
        "api_version": 2,
        "server_version": env!("CARGO_PKG_VERSION"),
        "pid": std::process::id(),
        "host": address.ip().to_string(),
        "port": address.port(),
    });
    let mut output = std::io::stdout().lock();
    writeln!(output, "{record}").map_err(|_| ServerError::Initialize)?;
    output.flush().map_err(|_| ServerError::Initialize)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn handshake_requires_bounded_json_and_a_visible_ascii_token() {
        for value in [
            serde_json::json!({"token":"short"}).to_string() + "\n",
            serde_json::json!({"token":"x".repeat(4097)}).to_string() + "\n",
            serde_json::json!({"token":"x".repeat(32) + "\n"}).to_string() + "\n",
            serde_json::json!({"token":"x".repeat(32),"unknown":true}).to_string() + "\n",
            "x".repeat(16385) + "\n",
            "x".repeat(4097) + "\n",
            "x".repeat(32) + "\r\n",
            "x".repeat(32),
            "x".repeat(32) + " \n",
        ] {
            assert!(read_handshake(&mut value.as_bytes()).await.is_err());
        }
        let value = serde_json::json!({"token":"x".repeat(4096)}).to_string() + "\n";
        assert_eq!(
            read_handshake(&mut value.as_bytes())
                .await
                .unwrap()
                .token
                .len(),
            4096
        );
    }
}
