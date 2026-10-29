import escapeHtml from 'escape-html';

import { frontendLink, frontendUrl } from '../../config/frontend';
import { RenderedMail } from '../mail.types';
import { MailTranslator } from '../mail-i18n';

/** What changes from one mail to the next; the frame around it is the same for every mail. */
export interface MailLayout {
  subject: string;
  /** The line inboxes show after the subject; never displayed in the mail itself. */
  preheader: string;
  /** Small caps beside the logo, naming the kind of mail. */
  tag: string;
  /** Small caps above the heading. */
  eyebrow: string;
  heading: string;
  /** Plain text: escaped here, so a name or a message a user wrote cannot inject markup. */
  paragraphs: string[];
  /** A short value shown on the screen-like block, for a mail that carries one to type in. */
  code?: { label: string; value: string };
  /**
   * The button. `backup` writes its URL out under it, for a link worth copying by hand when the
   * button does not work: a single-use one, not a way to the home page.
   */
  action?: { label: string; url: string; backup: boolean };
  /** Smaller print under the divider. */
  notes: string[];
}

// The palette of the design, in hex: mail clients know neither CSS variables nor the app's tokens.
const COLOUR = {
  page: '#0B0A09',
  card: '#131110',
  cardBorder: '#2A2621',
  field: '#0A0806',
  fieldBorder: '#35302A',
  screen: '#071108',
  screenInk: '#10D275',
  ink: '#EDE6DA',
  body: '#C8BFB3',
  note: '#9C9287',
  muted: '#8A8177',
  faint: '#756C61',
  divider: '#241F1B',
  accent: '#FFD100',
} as const;

// Clients that load web fonts get the app's own faces; every other one falls back by name.
const UI_FONT = "font-family:'NauctoUI',Verdana,Geneva,sans-serif;";
const MONO_FONT = "font-family:'NauctoMono','Courier New',Courier,monospace;";
const SMALL_CAPS = `${MONO_FONT}font-size:10px;line-height:14px;letter-spacing:1.4px;text-transform:uppercase;color:${COLOUR.muted};`;

/** Keeps an inbox from padding a short preheader out with the start of the body. */
const PREHEADER_FILLER = ' ͏ '.repeat(40);

/** Width of the logo as drawn; the file is twice that, for high-density screens. */
const LOGO_WIDTH = 132;
/** Width of the button for Outlook, which draws it from a fixed-size shape. */
const OUTLOOK_BUTTON_WIDTH = 486;

const TABLE = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"';

function row(content: string, padding: string): string {
  return `<tr><td class="px" style="padding:${padding};">${content}</td></tr>`;
}

function codeBlock(code: { label: string; value: string }): string {
  return row(
    `<table ${TABLE}><tr><td bgcolor="${COLOUR.screen}" style="background-color:${COLOUR.screen};` +
      `background-image:repeating-linear-gradient(0deg,rgba(16,210,117,0.05) 0px,rgba(16,210,117,0.05) 1px,transparent 1px,transparent 3px);` +
      `border:1px solid ${COLOUR.fieldBorder};border-radius:3px;padding:14px 16px;${MONO_FONT}font-size:12px;line-height:20px;letter-spacing:0.5px;color:${COLOUR.screenInk};mso-line-height-rule:exactly;">` +
      `&gt; ${escapeHtml(code.label)}:<br><span style="font-size:28px;line-height:40px;letter-spacing:10px;color:${COLOUR.ink};">${escapeHtml(code.value)}</span>` +
      `</td></tr></table>`,
    '0 36px 20px 36px',
  );
}

function button(
  action: { label: string; url: string; backup: boolean },
  backupLabel: string,
): string {
  const url = escapeHtml(action.url);
  const label = escapeHtml(action.label);
  return (
    row(
      `<table ${TABLE}><tr><td bgcolor="${COLOUR.accent}" align="center" style="background-color:${COLOUR.accent};border-radius:3px;">` +
        // Outlook ignores padding on links, so it gets a shape of its own to click.
        `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:46px;v-text-anchor:middle;width:${String(OUTLOOK_BUTTON_WIDTH)}px;" arcsize="7%" fillcolor="${COLOUR.accent}" stroke="f"><center style="color:${COLOUR.page};font-family:Verdana,sans-serif;font-size:13px;letter-spacing:1px;">${label}</center></v:roundrect><![endif]-->` +
        `<!--[if !mso]><!--><a href="${url}" style="display:block;padding:14px 20px;${UI_FONT}font-size:13px;line-height:18px;letter-spacing:1px;text-transform:uppercase;color:${COLOUR.page};text-decoration:none;border-radius:3px;">${label}</a><!--<![endif]-->` +
        `</td></tr></table>`,
      '0 36px 0 36px',
    ) + (action.backup ? backupLink(url, backupLabel) : '')
  );
}

function backupLink(url: string, backupLabel: string): string {
  return row(
    `<p style="margin:0 0 7px 0;${SMALL_CAPS}">${escapeHtml(backupLabel)}</p>` +
      `<table ${TABLE}><tr><td bgcolor="${COLOUR.field}" style="background-color:${COLOUR.field};border:1px solid ${COLOUR.fieldBorder};border-radius:3px;padding:10px 12px;${MONO_FONT}font-size:11px;line-height:17px;word-break:break-all;">` +
      `<a href="${url}" style="color:${COLOUR.body};text-decoration:none;">${url}</a>` +
      `</td></tr></table>`,
    '22px 36px 0 36px',
  );
}

/** Wraps one mail's content in the Naucto frame: logo, card, and the footer every mail shares. */
export function renderLayout({ locale, t }: MailTranslator, layout: MailLayout): RenderedMail {
  const backupLabel = t('layout.backupLink');
  const privacyLabel = t('layout.privacy');
  const automated = t('layout.automated');
  const home = frontendUrl();
  const homeLabel = new URL(home).host;
  const year = String(new Date().getFullYear());

  const paragraphs = layout.paragraphs
    .map(
      (text, i) =>
        `<p style="margin:0 0 ${i === layout.paragraphs.length - 1 ? '24' : '12'}px 0;${UI_FONT}font-size:13px;line-height:21px;letter-spacing:0.2px;color:${COLOUR.body};mso-line-height-rule:exactly;">${escapeHtml(text)}</p>`,
    )
    .join('');
  const notes = layout.notes
    .map(
      (text) =>
        `<p style="margin:0 0 8px 0;${UI_FONT}font-size:12px;line-height:19px;letter-spacing:0.2px;color:${COLOUR.note};mso-line-height-rule:exactly;">${escapeHtml(text)}</p>`,
    )
    .join('');

  const html =
    `<!DOCTYPE html><html lang="${locale}" xmlns="http://www.w3.org/1999/xhtml"><head>` +
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    // Dark by design: told to clients so they do not invert it.
    `<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">` +
    `<title>${escapeHtml(layout.subject)}</title>` +
    `<!--[if mso]><style>table,td{font-family:Verdana,Arial,sans-serif!important}</style><![endif]-->` +
    `<style>` +
    `@font-face{font-family:'NauctoUI';src:url("${frontendLink('/fonts/hd44780-variable.ttf')}") format('truetype');font-weight:normal;font-style:normal}` +
    `@font-face{font-family:'NauctoMono';src:url("${frontendLink('/fonts/hd44780-mono.ttf')}") format('truetype');font-weight:normal;font-style:normal}` +
    `@media (max-width:620px){.px{padding-left:22px!important;padding-right:22px!important}.h1{font-size:22px!important;line-height:28px!important}}` +
    `a{color:${COLOUR.accent}}` +
    `</style></head>` +
    `<body style="margin:0;padding:0;background-color:${COLOUR.page};">` +
    `<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;">${escapeHtml(layout.preheader)}${PREHEADER_FILLER}</span>` +
    `<table ${TABLE} bgcolor="${COLOUR.page}" style="background-color:${COLOUR.page};"><tr><td align="center" style="padding:40px 16px;">` +
    `<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;">` +
    // Header: logo and the kind of mail.
    `<tr><td style="padding:0 4px 20px 4px;"><table ${TABLE}><tr>` +
    `<td align="left" valign="middle"><img src="${frontendLink('/img/email-logo.png')}" width="${String(LOGO_WIDTH)}" alt="NAUCTO" style="display:block;width:${String(LOGO_WIDTH)}px;height:auto;border:0;outline:none;color:${COLOUR.ink};${MONO_FONT}font-size:16px;letter-spacing:2px;"></td>` +
    `<td align="right" valign="middle" style="${SMALL_CAPS}">${escapeHtml(layout.tag)}</td>` +
    `</tr></table></td></tr>` +
    // Card.
    `<tr><td bgcolor="${COLOUR.card}" style="background-color:${COLOUR.card};border:1px solid ${COLOUR.cardBorder};border-radius:6px;">` +
    `<table ${TABLE}>` +
    row(
      `<p style="margin:0 0 12px 0;${SMALL_CAPS}letter-spacing:1.6px;mso-line-height-rule:exactly;">${escapeHtml(layout.eyebrow)}</p>` +
        `<h1 class="h1" style="margin:0 0 12px 0;${UI_FONT}font-size:24px;line-height:30px;font-weight:normal;letter-spacing:0.5px;color:${COLOUR.ink};mso-line-height-rule:exactly;">${escapeHtml(layout.heading)}</h1>` +
        paragraphs,
      '30px 36px 0 36px',
    ) +
    (layout.code ? codeBlock(layout.code) : '') +
    (layout.action ? button(layout.action, backupLabel) : '') +
    row(
      `<table ${TABLE}><tr><td height="1" bgcolor="${COLOUR.divider}" style="height:1px;line-height:1px;font-size:0;background-color:${COLOUR.divider};">&nbsp;</td></tr></table>`,
      '24px 36px 0 36px',
    ) +
    row(notes, '18px 36px 22px 36px') +
    `</table></td></tr>` +
    // Footer.
    `<tr><td align="center" style="padding:24px 16px 0 16px;">` +
    `<p style="margin:0 0 8px 0;${MONO_FONT}font-size:10px;line-height:15px;letter-spacing:1.2px;text-transform:uppercase;color:${COLOUR.faint};">` +
    `<a href="${escapeHtml(frontendLink('/privacy'))}" style="color:${COLOUR.muted};text-decoration:none;">${escapeHtml(privacyLabel)}</a>` +
    ` &nbsp;·&nbsp; <a href="${escapeHtml(home)}" style="color:${COLOUR.muted};text-decoration:none;">${escapeHtml(homeLabel)}</a></p>` +
    `<p style="margin:0;${UI_FONT}font-size:11px;line-height:17px;color:${COLOUR.faint};">${escapeHtml(automated)}<br>© ${year} NAUCTO</p>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`;

  const text = [
    layout.heading,
    '',
    ...layout.paragraphs.flatMap((line) => [line, '']),
    ...(layout.code ? [`${layout.code.label}: ${layout.code.value}`, ''] : []),
    ...(layout.action ? [`${layout.action.label}: ${layout.action.url}`, ''] : []),
    ...layout.notes.flatMap((line) => [line, '']),
    '--',
    automated,
    `${privacyLabel}: ${frontendLink('/privacy')}`,
  ].join('\n');

  return { subject: layout.subject, html, text };
}
