use super::{Authorization, challenge};
use crate::{
    accounts::{AccountError, Credential, random_string},
    error::ProviderError,
    providers::{ProviderContext, http},
};
use serde::Deserialize;
use serde_json::json;

const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const REDIRECT: &str = "https://platform.claude.com/oauth/code/callback";
const SCOPE: &str =
    "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

pub(super) fn begin() -> Result<Authorization, AccountError> {
    let state = random_string()?;
    let verifier = random_string()?;
    let mut url = reqwest::Url::parse("https://claude.ai/oauth/authorize")
        .map_err(|_| AccountError::OAuth)?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", CLIENT_ID),
        ("redirect_uri", REDIRECT),
        ("response_type", "code"),
        ("scope", &format!("org:create_api_key {SCOPE}")),
        ("state", &state),
        ("code", "true"),
        ("code_challenge", &challenge(&verifier)),
        ("code_challenge_method", "S256"),
    ]);
    Ok(Authorization {
        state,
        verifier,
        nonce: String::new(),
        url: url.into(),
    })
}
fn manual_code<'a>(raw: &'a str, state: &str) -> Result<&'a str, AccountError> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 8192 || raw.chars().any(char::is_control) {
        return Err(AccountError::OAuth);
    }
    let (code, returned_state) = raw
        .split_once('#')
        .map_or((raw, None), |(c, s)| (c, Some(s)));
    if code.is_empty() || returned_state.is_some_and(|s| s != state) {
        return Err(AccountError::OAuth);
    }
    Ok(code)
}
#[derive(Deserialize)]
struct Identity {
    uuid: String,
    email_address: String,
}
#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: i64,
    account: Option<Identity>,
}
fn credential(
    tokens: Tokens,
    previous: Option<&Credential>,
    now: i64,
) -> Result<Credential, AccountError> {
    let old = match previous {
        Some(Credential::ClaudeOAuth {
            refresh_token,
            account_id,
            email,
            ..
        }) => Some((refresh_token, account_id, email)),
        _ => None,
    };
    let identity = tokens
        .account
        .or_else(|| {
            old.map(|(_, id, email)| Identity {
                uuid: id.clone(),
                email_address: email.clone(),
            })
        })
        .ok_or(AccountError::OAuth)?;
    if identity.uuid.is_empty()
        || identity.email_address.is_empty()
        || tokens.access_token.is_empty()
        || tokens.expires_in <= 0
        || old
            .is_some_and(|(_, id, email)| *id != identity.uuid || *email != identity.email_address)
    {
        return Err(AccountError::OAuth);
    }
    let refresh_token = tokens
        .refresh_token
        .or_else(|| old.map(|v| v.0.clone()))
        .filter(|v| !v.is_empty())
        .ok_or(AccountError::OAuth)?;
    Ok(Credential::ClaudeOAuth {
        access_token: tokens.access_token,
        refresh_token,
        account_id: identity.uuid,
        email: identity.email_address,
        expires_at: now
            .checked_add(tokens.expires_in)
            .ok_or(AccountError::OAuth)?,
        refresh_pending: false,
    })
}
pub(super) async fn exchange(
    context: &ProviderContext,
    authorization: Authorization,
    raw: &str,
) -> Result<Credential, AccountError> {
    exchange_at(context, authorization, raw, TOKEN_URL).await
}
pub(super) async fn exchange_at(
    context: &ProviderContext,
    authorization: Authorization,
    raw: &str,
    endpoint: &str,
) -> Result<Credential, AccountError> {
    let code = manual_code(raw, &authorization.state)?;
    let tokens = http::json(context.http.post(endpoint).json(&json!({
        "grant_type": "authorization_code", "code": code, "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT, "code_verifier": authorization.verifier, "state": authorization.state,
    })), context.clock.now()).await?;
    credential(tokens, None, context.clock.now().unix_timestamp())
}
pub(crate) async fn refresh(
    context: &ProviderContext,
    previous: &Credential,
) -> Result<Credential, AccountError> {
    refresh_at(context, previous, TOKEN_URL).await
}
async fn refresh_at(
    context: &ProviderContext,
    previous: &Credential,
    endpoint: &str,
) -> Result<Credential, AccountError> {
    let Credential::ClaudeOAuth { refresh_token, .. } = previous else {
        return Err(AccountError::Unsupported);
    };
    let response = match context.http.post(endpoint).json(&json!({
        "grant_type": "refresh_token", "refresh_token": refresh_token, "client_id": CLIENT_ID, "scope": SCOPE,
    })).send().await {
        Ok(response) => response,
        Err(error) if error.is_connect() => {
            return Err(AccountError::RefreshUnused(http::send_error(error)));
        }
        Err(error) => return Err(http::send_error(error).into()),
    };
    // Waiting out Retry-After here could outlive the fetch deadline and skip the fence release.
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err(AccountError::RefreshUnused(ProviderError::RateLimited));
    }
    let tokens = http::json_response(response, context.clock.now()).await?;
    credential(tokens, Some(previous), context.clock.now().unix_timestamp())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn refresh_reports_requests_the_provider_never_processed() {
        let previous = Credential::ClaudeOAuth {
            access_token: "old".into(),
            refresh_token: "refresh".into(),
            account_id: "id".into(),
            email: "demo@example.com".into(),
            expires_at: 0,
            refresh_pending: true,
        };
        for (status, body, unused) in [
            (429, json!({}), true),
            (400, json!({"error":"invalid_grant"}), false),
            (401, json!({}), false),
            (500, json!({}), false),
            (200, json!({"access_token":"new"}), false),
        ] {
            let (url, task) = http::fixture::server_status(vec![(status, body)]).await;
            let result = refresh_at(&http::fixture::context(), &previous, &url).await;
            task.await.unwrap();
            assert_eq!(
                matches!(result, Err(AccountError::RefreshUnused(_))),
                unused,
                "status {status}"
            );
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        assert!(matches!(
            refresh_at(&http::fixture::context(), &previous, &url).await,
            Err(AccountError::RefreshUnused(ProviderError::Transient))
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 8192];
            let _ = socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 429 Test\r\nRetry-After: 600\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                .await
                .unwrap();
        });
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            refresh_at(&http::fixture::context(), &previous, &url),
        )
        .await
        .expect("a 429 must not wait out Retry-After");
        assert!(matches!(
            result,
            Err(AccountError::RefreshUnused(ProviderError::RateLimited))
        ));
        task.await.unwrap();
    }
    #[tokio::test]
    async fn exchange_and_refresh_contract() {
        let authorization = begin().unwrap();
        let code = format!("fixture-code#{}", authorization.state);
        assert!(manual_code("code#wrong", &authorization.state).is_err());
        assert!(manual_code("#", "").is_err());
        let (url, task) = http::fixture::server(vec![json!({"access_token":"fixture-access","refresh_token":"fixture-refresh","expires_in":3600,"account":{"uuid":"id","email_address":"demo@example.com"}})]).await;
        let credential = exchange_at(&http::fixture::context(), authorization, &code, &url)
            .await
            .unwrap();
        let requests = task.await.unwrap();
        assert!(requests[0].contains("application/json"));
        assert!(requests[0].contains("code_verifier"));
        for account in [
            None,
            Some(json!({"uuid":"other","email_address":"demo@example.com"})),
        ] {
            let (url, task) = http::fixture::server(vec![json!({"access_token":"new","refresh_token":"rotated","expires_in":3600,"account":account})]).await;
            let result = refresh_at(&http::fixture::context(), &credential, &url).await;
            assert_eq!(result.is_ok(), account.is_none());
            let requests = task.await.unwrap();
            assert!(requests[0].contains(SCOPE));
            assert!(!requests[0].contains("org:create_api_key"));
        }
    }
}
