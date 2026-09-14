//! 命令行参数解析。
//!
//! 仅识别显式操作参数；未知参数直接报错，绝不静默启动服务。`--migrate`、
//! `--check-baseline`、`--adopt-baseline`、`--healthcheck` 互斥，重复命令被拒绝；
//! `--healthcheck` 允许至多一个可选探针路径，未给参数时进入普通只读启动。

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Serve,
    Migrate,
    CheckBaseline,
    AdoptBaseline,
    /// 对本地探针做一次 GET；`Some` 为可选路径，语义校验在 [`crate::healthcheck`]。
    Healthcheck(Option<String>),
    Help,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CliError {
    #[error(
        "存在未知参数；仅支持 --migrate、--check-baseline、--adopt-baseline、--healthcheck [path]"
    )]
    Unknown,
    #[error("--migrate、--check-baseline、--adopt-baseline、--healthcheck 互斥，只能指定一个")]
    Conflicting,
}

pub const USAGE: &str = "\
用法: lycoris-backend [选项]

选项:
  (无)                 普通启动：只读校验迁移已应用，不执行 DDL
  --migrate            对空库执行 SQLx 迁移后退出
  --check-baseline     只读预检已有库结构与发布决策计数，不修改数据库
  --adopt-baseline     核对已有库结构并登记原始基线真实校验和后退出
  --healthcheck [path] 对本地探针做一次 GET 后退出（默认 /health/ready）
  -h, --help           显示本帮助";

pub fn parse<I>(args: I) -> Result<Command, CliError>
where
    I: IntoIterator<Item = String>,
{
    let mut selected: Option<Command> = None;
    for arg in args {
        match arg.as_str() {
            "--help" | "-h" => return Ok(Command::Help),
            "--migrate" => select(&mut selected, Command::Migrate)?,
            "--check-baseline" => select(&mut selected, Command::CheckBaseline)?,
            "--adopt-baseline" => select(&mut selected, Command::AdoptBaseline)?,
            "--healthcheck" => select(&mut selected, Command::Healthcheck(None))?,
            // 非选项 token 只可能是健康检查的可选路径；其余情况一律拒绝。
            _ => match &mut selected {
                Some(Command::Healthcheck(path)) if path.is_none() && !arg.starts_with('-') => {
                    *path = Some(arg);
                }
                _ => return Err(CliError::Unknown),
            },
        }
    }
    Ok(selected.unwrap_or(Command::Serve))
}

/// 记录首个执行命令；再次出现任何命令（含重复）都视为互斥冲突。
fn select(selected: &mut Option<Command>, command: Command) -> Result<(), CliError> {
    if selected.is_some() {
        return Err(CliError::Conflicting);
    }
    *selected = Some(command);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{CliError, Command, parse};

    fn args(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| (*item).to_string()).collect()
    }

    #[test]
    fn defaults_to_serve_without_arguments() {
        assert_eq!(parse(args(&[])).unwrap(), Command::Serve);
    }

    #[test]
    fn recognizes_explicit_commands() {
        assert_eq!(parse(args(&["--migrate"])).unwrap(), Command::Migrate);
        assert_eq!(
            parse(args(&["--check-baseline"])).unwrap(),
            Command::CheckBaseline
        );
        assert_eq!(
            parse(args(&["--adopt-baseline"])).unwrap(),
            Command::AdoptBaseline
        );
        assert_eq!(parse(args(&["--help"])).unwrap(), Command::Help);
    }

    #[test]
    fn recognizes_healthcheck_with_optional_path() {
        assert_eq!(
            parse(args(&["--healthcheck"])).unwrap(),
            Command::Healthcheck(None)
        );
        assert_eq!(
            parse(args(&["--healthcheck", "/health/ready"])).unwrap(),
            Command::Healthcheck(Some("/health/ready".to_string()))
        );
        assert_eq!(
            parse(args(&["--healthcheck", "health/ready"])).unwrap(),
            Command::Healthcheck(Some("health/ready".to_string()))
        );
    }

    #[test]
    fn rejects_healthcheck_extra_unknown_or_conflicting_arguments() {
        assert_eq!(
            parse(args(&["--healthcheck", "--healthcheck"])).unwrap_err(),
            CliError::Conflicting
        );
        assert_eq!(
            parse(args(&["--healthcheck", "/a", "/b"])).unwrap_err(),
            CliError::Unknown
        );
        // 两侧多余命令必须因互斥被拒绝，而不是被吞成探针路径。
        assert_eq!(
            parse(args(&["--healthcheck", "--migrate"])).unwrap_err(),
            CliError::Conflicting
        );
        assert_eq!(
            parse(args(&["--migrate", "--healthcheck"])).unwrap_err(),
            CliError::Conflicting
        );
        assert_eq!(
            parse(args(&["--healthcheck", "--bogus"])).unwrap_err(),
            CliError::Unknown
        );
        assert_eq!(
            parse(args(&["--healthcheck", "path", "extra"])).unwrap_err(),
            CliError::Unknown
        );
    }

    #[test]
    fn rejects_unknown_arguments() {
        assert_eq!(parse(args(&["--bogus"])).unwrap_err(), CliError::Unknown);
        assert_eq!(
            parse(args(&["--adopt-baseline", "extra"])).unwrap_err(),
            CliError::Unknown
        );
    }

    #[test]
    fn rejects_conflicting_commands() {
        assert_eq!(
            parse(args(&["--migrate", "--adopt-baseline"])).unwrap_err(),
            CliError::Conflicting
        );
        assert_eq!(
            parse(args(&["--check-baseline", "--migrate"])).unwrap_err(),
            CliError::Conflicting
        );
    }
}
