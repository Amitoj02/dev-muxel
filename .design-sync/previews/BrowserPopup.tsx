import { BrowserPopup } from 'devlobby'

/*
 * Reads its pane out of the session for the name in the header, so the id has
 * to be a real one — p3 is the browser pane on localhost:5173. The guest id is
 * only ever handed back to main, and there is no main here.
 */

/** The ordinary case: a link on the page you are reading wants a tab. */
export const Default = (): React.JSX.Element => (
  <BrowserPopup paneId="p3" guestId={1} url="https://docs.stripe.com/payments/quickstart" />
)

/** A long address wraps and scrolls rather than pushing the dialog wider. */
export const LongUrl = (): React.JSX.Element => (
  <BrowserPopup
    paneId="p3"
    guestId={1}
    url={
      'https://analytics.example.com/r?campaign=spring-sale-2026&utm_source=newsletter' +
      '&utm_medium=email&utm_content=hero-button&redirect=https%3A%2F%2Fshop.example.com' +
      '%2Fcheckout%3Fsession%3D9f2c41ab8e7d4f60b1a3'
    }
  />
)
