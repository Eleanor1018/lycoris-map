#![forbid(unsafe_code)]

//! Shared API services. [`app`] wires the HTTP boundary; [`modules::markers`] owns
//! place reads and writes; [`media`] owns image access and upload recovery.
//!
//! [`auth`], [`session`], and [`email_verification`] enforce identity and account
//! recovery. [`migrate`] verifies the schema at startup; migration and baseline
//! adoption are explicit commands, never side effects of serving requests.

pub mod app;
pub mod auth;
pub mod baseline;
pub mod cli;
pub mod config;
pub mod db;
pub mod dto;
pub mod email_verification;
pub mod error;
pub mod healthcheck;
pub mod media;
pub mod migrate;
pub mod modules;
pub mod multipart;
pub mod origin;
pub mod password;
pub mod ratelimit;
pub mod routes;
pub mod session;
pub mod users;
pub mod web;
