<!-- Copyright 2026 Cole Munz -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Proxy and Tor

Signal Desktop has no proxy setting. It reads an `HTTPS_PROXY` environment variable that it doesn't document, and Chromium inside it takes a `--proxy-server` flag. Neither one tells you when something went around the proxy.

Wren Desktop has a Proxy section in Settings, Privacy. You pick Tor, a SOCKS5 proxy or an HTTP proxy, and there is a switch called "Only connect through the proxy". This page covers how to set it up, what the switch really does, what still gets out, and how to check on your own machine.

## Tor

1. Run Tor. The `tor` service listens on 127.0.0.1:9050. Tor Browser runs its own Tor on 127.0.0.1:9150, which works too while Tor Browser is open.
2. Settings, Privacy, Proxy. Set "Connect through" to Tor. Change the port to 9150 if you use Tor Browser's.
3. Press Test. Wren sends one request through Tor to Signal's chat server and tells you if it answered.
4. Press Save, then Restart now. The proxy is set up at startup, before anything touches the network, so a change needs a restart.

Each start Wren makes up a random SOCKS username and password for Tor. Tor puts connections with different credentials on different circuits, so Wren doesn't share circuits with Tor Browser or anything else using the same Tor. Nothing about it is stored.

## A SOCKS5 proxy

Pick SOCKS5 proxy and fill in host, port and, if the proxy wants them, a username and password (up to 255 bytes each, the SOCKS5 limit). Wren always talks to it as `socks5h`: the proxy gets the name `chat.signal.org`, not an address your computer looked up. Plain `socks5` makes the client resolve names itself, which tells your DNS server you use Signal. I checked libsignal on this: with `socks5` it sent the proxy IP addresses it had resolved, with `socks5h` it sent the name.

Use an IP address for the proxy host if you can. With a name, Wren has to look up the proxy's own name before it can use it. That lookup shows which proxy you use, not that you use Signal.

The credentials are stored in `config.json` in Wren's data folder, in plain text, like the rest of that file. They never go into logs: a log line says what kind of proxy is in use, whether it's on this computer, and whether it has credentials, and nothing more.

## An HTTP proxy

Pick HTTP proxy and give a URL like `http://proxy.example:3128` or `https://user:password@proxy.example`. Wren uses the CONNECT method, so the proxy sees the host name and port but not the traffic, which stays TLS from Wren to Signal.

## The environment variable and the flag

They still work, and they win over the setting:

- `HTTPS_PROXY` (or `https_proxy`) replaces the saved proxy for everything the app does in Node and in libsignal. If it starts with `socks5://` or `socks4://`, Wren turns it into `socks5h://` or `socks4a://` so names are resolved at the proxy. The "only through the proxy" switch still applies when a saved proxy is on.
- `--proxy-server` replaces the saved proxy for the Chromium layer only, same as in Signal Desktop.

Settings shows a note when either one is in effect.

## What "Only connect through the proxy" does

It is on by default. With it on:

- Calls are off. Starting one shows a short message. Incoming one to one calls are recorded as missed and group rings are dropped, so call media never starts.
- GIF search is off. See the table for why.
- Signal's network library (libsignal) is held on a blocked setting until a test request through the proxy has reached Signal. It is checked again every 3 seconds and blocked again the moment the proxy stops answering.
- While it is blocked, the left pane says "Proxy unreachable, not connecting".

With it off, calls and GIF search work but go out directly, and libsignal behaves as described in the next section with no guard at all.

In both modes, the connections that Wren makes itself (everything in the table marked "Through the proxy") never switch to a direct connection. If the proxy is down they fail.

If `config.json` holds proxy settings Wren can't read, it doesn't treat that as "no proxy". It points every layer at a closed port on 127.0.0.1, turns the switch on, and tells you in Settings until you save new settings.

## The gap I can't close in Wren

libsignal handles the chat connection, contact discovery, PIN recovery, key transparency and the link with your phone. When you give it a SOCKS or HTTP proxy, it treats it as "proxy, then direct". In the libsignal source this is `infer_proxy_mode_for_config`: only Signal's own TLS proxies get "proxy only", everything else gets `ProxyThenDirect`, because a proxy might have come from the system and not meant for Signal. There is no way to change that from JavaScript.

I measured it with libsignal 0.103.0 in a network namespace that has a fake default route, capturing every packet:

- Proxy port closed: libsignal tried the proxy, got refused, and within 2 ms sent TCP SYNs straight to Signal (76.223.66.180, 15.197.251.99 and two Cloudfront IPv6 addresses on port 443). That's with `socks5h`, `socks5` and `http` alike. This is what stock Signal Desktop does with `HTTPS_PROXY` set.
- Proxy accepting but slow: libsignal started the proxied connection, and 500 ms later began direct connections to the same addresses in parallel.
- With Wren's guard and the proxy port closed: no packets left the namespace at all, only the loopback probe.

So with "only through the proxy" on, a proxy that is down or not working means libsignal does not connect. That part is fixed. What is left is the race: while the proxy works but is slow, and Tor often is, libsignal can open a direct connection to Signal next to the proxied one, and use it if it wins. That shows Signal your IP address and shows your network that you use Signal.

The real fix is in libsignal: let the app ask for "proxy only" for SOCKS and HTTP proxies. It's a small change in `rust/bridge/shared/src/net.rs`, and I plan to ask for it upstream. Until Wren ships a libsignal with that, use the firewall rule below if a direct connection must never happen.

## Every network path

| Path                                                                           | Code                                                   | Through the proxy?                                                                                                                      | With "only through the proxy"                          |
| ------------------------------------------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Chat connection, contact discovery, PIN/SVR, key transparency, linking         | libsignal `Net`                                        | Yes, but libsignal also tries direct (see above)                                                                                        | Blocked until the proxy reaches Signal; the race stays |
| REST calls to the chat server, storage service, groups, profiles, avatars      | `ts/textsecure/WebAPI.preload.ts`, `createProxyAgent`  | Yes, no fallback                                                                                                                        | Same                                                   |
| Attachment and backup media download and upload (cdn, cdn2, cdn3, tus uploads) | WebAPI, `createFetchForAttachmentUpload`               | Yes, no fallback                                                                                                                        | Same                                                   |
| Sticker packs                                                                  | WebAPI                                                 | Yes, no fallback                                                                                                                        | Same                                                   |
| Link previews (fetching the linked site)                                       | WebAPI `fetchForLinkPreviews`                          | Yes, the site sees the proxy's address                                                                                                  | Same                                                   |
| GIF search and GIF download (Giphy)                                            | `fetchJsonViaProxy`, `fetchBytesViaProxy`              | No. They go through Signal's content proxy, which is an HTTP proxy of its own and can't be chained behind yours                         | Off                                                    |
| Call signaling and the TURN server list                                        | over the chat connection                               | Yes (libsignal)                                                                                                                         | Calls off                                              |
| Group call and call link requests to the SFU                                   | `makeSfuRequest` in WebAPI                             | Yes, no fallback                                                                                                                        | Calls off                                              |
| Call audio and video                                                           | RingRTC, its own WebRTC stack                          | No. RingRTC has no proxy support, so media goes straight to Signal's TURN servers, the SFU or the other person                          | Off. Nothing in Wren starts it                         |
| Emoji sheets and other optional resources                                      | `app/OptionalResourceService.main.ts`, `getGotOptions` | Yes, no fallback                                                                                                                        | Same                                                   |
| Debug log upload                                                               | `ts/logging/uploadDebugLog.node.ts`                    | Yes. In Signal Desktop it went direct even with `HTTPS_PROXY` set                                                                       | Same                                                   |
| Updater                                                                        | `ts/updater/got.main.ts`                               | Yes. Updates are turned off in Wren builds anyway                                                                                       | Same                                                   |
| Spellcheck dictionaries                                                        | Chromium session                                       | Yes, through `--proxy-server`. Chromium can't send SOCKS or HTTP proxy credentials, so with a proxy that needs them this download fails | Same                                                   |
| Outage check (a DNS lookup of uptime.signal.org)                               | `ts/services/networkObserver.preload.ts`               | No, it is a plain DNS query                                                                                                             | Skipped whenever any proxy is set                      |
| DNS fallback table                                                             | `app/dns-fallback.main.ts`, `ts/util/dns.node.ts`      | Not a connection. It is a list of addresses used only for direct connections when DNS fails. Nothing behind a proxy uses it             | Not used                                               |
| Proxy host name                                                                | Node, Chromium and libsignal resolvers                 | No. Only the proxy's name is looked up, never Signal's                                                                                  | Use an IP address to avoid it                          |
| Captcha, donation pages, links you click                                       | your browser                                           | No, they open outside Wren                                                                                                              | Not covered                                            |
| Crash reports                                                                  | Electron crashReporter                                 | Not uploaded at all                                                                                                                     |                                                        |

## Checking it yourself

Don't take my word for it. These are the checks I'd run.

See Wren's own sockets, no root needed:

```sh
watch -n1 "ss -tunp | grep -i wren"
```

With Tor on 9050, every line should have `127.0.0.1:9050` as the peer. Anything else is Wren talking past the proxy.

Check the fail-closed case with tcpdump. Stop Tor, close every other program that uses the network, start Wren with "only through the proxy" on, and watch:

```sh
sudo tcpdump -n -i any 'not (host 127.0.0.1 or host ::1)'
```

You should see nothing from Wren while it says "Proxy unreachable, not connecting". Start Tor again and you should see only Tor's own connections to its guard relays.

To make it airtight, block direct traffic in the firewall so only Tor can reach the internet. With nftables on Linux, where Tor runs as the `tor` user (`debian-tor` on Debian and Ubuntu):

```sh
sudo nft add table inet toronly
sudo nft add chain inet toronly out '{ type filter hook output priority 0; policy drop; }'
sudo nft add rule inet toronly out oif lo accept
sudo nft add rule inet toronly out meta skuid tor accept
```

That blocks every other program on the machine too, which is the point of a Tor-only setup. Remove it with `sudo nft delete table inet toronly`. For a SOCKS proxy on another machine, replace the `skuid` rule with `ip daddr <proxy address> tcp dport <port> accept`. On Windows and macOS an outbound firewall such as Windows Defender Firewall rules, Little Snitch or LuLu can do the same for the Wren app.
