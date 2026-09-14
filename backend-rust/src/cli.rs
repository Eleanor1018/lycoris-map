//! 命令行参数解析。
//!
//! 仅识别显式操作参数；未知参数直接报错，绝不静默启动服务。`--migrate`、
//! `--check-baseline`、`--adopt-baseline` 互斥，未给参数时进入普通只读启动。

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Serve,
    Migrate,
    CheckBaseline,
    AdoptBaseline,
    Help,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum CliError {
    #[error("存在未知参数；仅支持 --migrate、--check-baseline、--adopt-baseline")]
    Unknown,
    #[error("--migrate、--check-baseline、--adopt-baseline 互斥，只能指定一个")]
    Conflicting,
}

pub const USAGE: &str = "\
用法: lycoris-backend [选项]

选项:
  (无)                 普通启动：只读校验迁移已应用，不执行 DDL
  --migrate            对空库执行 SQLx 迁移后退出
  --check-baseline     只读预检已有库结构与发布决策计数，不修改数据库
  --adopt-baseline     核对已有库结构并登记原始基线真实校验和后退出
  -h, --help           显示本帮助";

pub fn parse<I>(args: I) -> Result<Command, CliError>
where
    I: IntoIterator<Item = String>,
{
    let mut selected: Option<Command> = None;
    for arg in args {
        let command = match arg.as_str() {
            "--help" | "-h" => return Ok(Command::Help),
            "--migrate" => Command::Migrate,
            "--check-baseline" => Command::CheckBaseline,
            "--adopt-baseline" => Command::AdoptBaseline,
            _ => return Err(CliError::Unknown),
        };
        if selected.is_some() {
            return Err(CliError::Conflicting);
        }
        selected = Some(command);
    }
    Ok(selected.unwrap_or(Command::Serve))
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
