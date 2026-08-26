/** A hand-picked list of well-known publishers, for the "Your own sources" autocomplete
 * (CustomSourcesSetting.tsx) — the fix for "it's super difficult to get the correct URL." Every
 * entry is just the publisher's own homepage, not a guessed-at feed path: picking one still runs
 * through the exact same discoverFeed pipeline (server/customSources/discover.ts) a manually-typed
 * URL does, which already tries the page itself, then its own <link rel="alternate">, then a
 * handful of conventional paths. That pipeline is the thing actually finding the real feed either
 * way — this list only removes the "know or guess the correct domain" step, which is what most of
 * the friction reports were actually about, not the feed-path guessing discoverFeed already
 * handles.
 *
 * Deliberately static, not a live directory lookup — no network dependency, no per-keystroke
 * latency, no API key/quota, and works offline. The tradeoff (documented, not hidden) is that this
 * needs an app update to add a publisher that isn't here yet; typing a URL directly still always
 * works regardless of whether it's in this list.
 *
 * Weighted toward US national news, tech/business, and the Bay Area — matching how this app is
 * actually used — rather than spread evenly across every possible category or region. Not
 * exhaustive: aims to cover most of what a typical user would think to add, not literally everyone
 * who publishes a feed. */

export interface CuratedSource {
  name: string;
  url: string;
}

export const CURATED_SOURCES: CuratedSource[] = [
  // --- Wire services & general national news --------------------------------------------------
  { name: 'Associated Press (AP News)', url: 'https://apnews.com' },
  { name: 'Reuters', url: 'https://www.reuters.com' },
  { name: 'NPR', url: 'https://www.npr.org' },
  { name: 'PBS NewsHour', url: 'https://www.pbs.org/newshour' },
  { name: 'USA Today', url: 'https://www.usatoday.com' },
  { name: 'CNN', url: 'https://www.cnn.com' },
  { name: 'Fox News', url: 'https://www.foxnews.com' },
  { name: 'ABC News', url: 'https://abcnews.go.com' },
  { name: 'CBS News', url: 'https://www.cbsnews.com' },
  { name: 'NBC News', url: 'https://www.nbcnews.com' },
  { name: 'MSNBC', url: 'https://www.msnbc.com' },
  { name: 'The Hill', url: 'https://thehill.com' },
  { name: 'Politico', url: 'https://www.politico.com' },
  { name: 'Axios', url: 'https://www.axios.com' },
  { name: 'HuffPost', url: 'https://www.huffpost.com' },
  { name: 'The Daily Beast', url: 'https://www.thedailybeast.com' },
  { name: 'Newsweek', url: 'https://www.newsweek.com' },
  { name: 'Time', url: 'https://time.com' },
  { name: 'U.S. News & World Report', url: 'https://www.usnews.com' },
  { name: 'Christian Science Monitor', url: 'https://www.csmonitor.com' },
  { name: 'The Week', url: 'https://theweek.com' },
  { name: 'Vox', url: 'https://www.vox.com' },
  { name: 'Slate', url: 'https://slate.com' },
  { name: 'Salon', url: 'https://www.salon.com' },
  { name: 'Semafor', url: 'https://www.semafor.com' },
  { name: 'The Free Press', url: 'https://www.thefp.com' },

  // --- Investigative & nonprofit newsrooms -----------------------------------------------------
  { name: 'ProPublica', url: 'https://www.propublica.org' },
  { name: 'The Marshall Project', url: 'https://www.themarshallproject.org' },
  { name: 'Mother Jones', url: 'https://www.motherjones.com' },
  { name: 'The Intercept', url: 'https://theintercept.com' },
  { name: 'Reveal (Center for Investigative Reporting)', url: 'https://revealnews.org' },
  { name: 'Center for Public Integrity', url: 'https://publicintegrity.org' },
  { name: 'The Texas Tribune', url: 'https://www.texastribune.org' },
  { name: 'CalMatters', url: 'https://calmatters.org' },
  { name: 'The Trace', url: 'https://www.thetrace.org' },

  // --- Major regional newspapers ----------------------------------------------------------------
  { name: 'The Los Angeles Times', url: 'https://www.latimes.com' },
  { name: 'Chicago Tribune', url: 'https://www.chicagotribune.com' },
  { name: 'The Boston Globe', url: 'https://www.bostonglobe.com' },
  { name: 'The Seattle Times', url: 'https://www.seattletimes.com' },
  { name: 'Miami Herald', url: 'https://www.miamiherald.com' },
  { name: 'The Dallas Morning News', url: 'https://www.dallasnews.com' },
  { name: 'Houston Chronicle', url: 'https://www.houstonchronicle.com' },
  { name: 'The Denver Post', url: 'https://www.denverpost.com' },
  { name: 'Star Tribune (Minneapolis)', url: 'https://www.startribune.com' },
  { name: 'The Philadelphia Inquirer', url: 'https://www.inquirer.com' },
  { name: 'The Atlanta Journal-Constitution', url: 'https://www.ajc.com' },
  { name: 'Detroit Free Press', url: 'https://www.freep.com' },
  { name: 'Cleveland.com', url: 'https://www.cleveland.com' },
  { name: 'The Arizona Republic', url: 'https://www.azcentral.com' },
  { name: 'Tampa Bay Times', url: 'https://www.tampabay.com' },
  { name: 'Orlando Sentinel', url: 'https://www.orlandosentinel.com' },
  { name: 'San Antonio Express-News', url: 'https://www.expressnews.com' },
  { name: 'St. Louis Post-Dispatch', url: 'https://www.stltoday.com' },
  { name: 'The Baltimore Sun', url: 'https://www.baltimoresun.com' },
  { name: 'The Charlotte Observer', url: 'https://www.charlotteobserver.com' },
  { name: 'The Sacramento Bee', url: 'https://www.sacbee.com' },
  { name: 'Las Vegas Review-Journal', url: 'https://www.reviewjournal.com' },
  { name: 'Pittsburgh Post-Gazette', url: 'https://www.post-gazette.com' },
  { name: 'The Kansas City Star', url: 'https://www.kansascity.com' },
  { name: 'The Oregonian', url: 'https://www.oregonlive.com' },
  { name: 'New York Daily News', url: 'https://www.nydailynews.com' },
  { name: 'New York Post', url: 'https://nypost.com' },
  { name: 'Newsday', url: 'https://www.newsday.com' },
  { name: 'The Indianapolis Star', url: 'https://www.indystar.com' },
  { name: 'The Columbus Dispatch', url: 'https://www.dispatch.com' },
  { name: 'The Cincinnati Enquirer', url: 'https://www.cincinnati.com' },
  { name: 'The Tennessean', url: 'https://www.tennessean.com' },
  { name: 'The Salt Lake Tribune', url: 'https://www.sltrib.com' },

  // --- National papers of record ------------------------------------------------------------------
  { name: 'The New York Times', url: 'https://www.nytimes.com' },
  { name: 'The Washington Post', url: 'https://www.washingtonpost.com' },
  { name: 'The Wall Street Journal', url: 'https://www.wsj.com' },
  { name: 'The Guardian', url: 'https://www.theguardian.com' },

  // --- Business & finance ------------------------------------------------------------------------
  { name: 'Bloomberg', url: 'https://www.bloomberg.com' },
  { name: 'CNBC', url: 'https://www.cnbc.com' },
  { name: 'Forbes', url: 'https://www.forbes.com' },
  { name: 'Fortune', url: 'https://fortune.com' },
  { name: 'Business Insider', url: 'https://www.businessinsider.com' },
  { name: 'MarketWatch', url: 'https://www.marketwatch.com' },
  { name: "Barron's", url: 'https://www.barrons.com' },
  { name: 'Fast Company', url: 'https://www.fastcompany.com' },
  { name: 'Inc.', url: 'https://www.inc.com' },
  { name: 'Quartz', url: 'https://qz.com' },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com' },
  { name: 'The Economist', url: 'https://www.economist.com' },
  { name: 'Financial Times', url: 'https://www.ft.com' },
  { name: 'Institutional Investor', url: 'https://www.institutionalinvestor.com' },

  // --- Technology ----------------------------------------------------------------------------------
  { name: 'TechCrunch', url: 'https://techcrunch.com' },
  { name: 'The Verge', url: 'https://www.theverge.com' },
  { name: 'Ars Technica', url: 'https://arstechnica.com' },
  { name: 'Wired', url: 'https://www.wired.com' },
  { name: 'Engadget', url: 'https://www.engadget.com' },
  { name: '9to5Mac', url: 'https://9to5mac.com' },
  { name: '9to5Google', url: 'https://9to5google.com' },
  { name: 'MacRumors', url: 'https://www.macrumors.com' },
  { name: 'ZDNet', url: 'https://www.zdnet.com' },
  { name: 'VentureBeat', url: 'https://venturebeat.com' },
  { name: 'The Information', url: 'https://www.theinformation.com' },
  { name: 'Gizmodo', url: 'https://gizmodo.com' },
  { name: 'Mashable', url: 'https://mashable.com' },
  { name: 'CNET', url: 'https://www.cnet.com' },
  { name: 'PCMag', url: 'https://www.pcmag.com' },
  { name: 'TechRadar', url: 'https://www.techradar.com' },
  { name: 'Android Authority', url: 'https://www.androidauthority.com' },
  { name: 'AnandTech', url: 'https://www.anandtech.com' },
  { name: 'Digital Trends', url: 'https://www.digitaltrends.com' },
  { name: 'The Register', url: 'https://www.theregister.com' },
  { name: 'Protocol', url: 'https://www.protocol.com' },
  { name: 'Tom’s Hardware', url: 'https://www.tomshardware.com' },
  { name: 'Hacker Noon', url: 'https://hackernoon.com' },

  // --- Science & health -----------------------------------------------------------------------------
  { name: 'Scientific American', url: 'https://www.scientificamerican.com' },
  { name: 'Nature News', url: 'https://www.nature.com/news' },
  { name: 'Science Daily', url: 'https://www.sciencedaily.com' },
  { name: 'New Scientist', url: 'https://www.newscientist.com' },
  { name: 'Live Science', url: 'https://www.livescience.com' },
  { name: 'Popular Science', url: 'https://www.popsci.com' },
  { name: 'National Geographic', url: 'https://www.nationalgeographic.com' },
  { name: 'WebMD', url: 'https://www.webmd.com' },
  { name: 'STAT News', url: 'https://www.statnews.com' },
  { name: 'Medical News Today', url: 'https://www.medicalnewstoday.com' },
  { name: 'Kaiser Health News (KFF Health News)', url: 'https://kffhealthnews.org' },
  { name: 'Smithsonian Magazine', url: 'https://www.smithsonianmag.com' },

  // --- Politics & policy ------------------------------------------------------------------------
  { name: 'RealClearPolitics', url: 'https://www.realclearpolitics.com' },
  { name: 'The Dispatch', url: 'https://thedispatch.com' },
  { name: 'National Review', url: 'https://www.nationalreview.com' },
  { name: 'The American Conservative', url: 'https://www.theamericanconservative.com' },
  { name: 'The Bulwark', url: 'https://www.thebulwark.com' },
  { name: 'FiveThirtyEight', url: 'https://fivethirtyeight.com' },
  { name: 'Roll Call', url: 'https://rollcall.com' },
  { name: 'Reason', url: 'https://reason.com' },
  { name: 'The Federalist', url: 'https://thefederalist.com' },
  { name: 'Talking Points Memo', url: 'https://talkingpointsmemo.com' },

  // --- Magazines & long-form ---------------------------------------------------------------------
  { name: 'The Atlantic', url: 'https://www.theatlantic.com' },
  { name: 'The New Yorker', url: 'https://www.newyorker.com' },
  { name: "Harper's Magazine", url: 'https://harpers.org' },
  { name: 'Vanity Fair', url: 'https://www.vanityfair.com' },
  { name: 'The New Republic', url: 'https://newrepublic.com' },
  { name: 'Foreign Affairs', url: 'https://www.foreignaffairs.com' },
  { name: 'Foreign Policy', url: 'https://foreignpolicy.com' },
  { name: 'GQ', url: 'https://www.gq.com' },
  { name: 'Esquire', url: 'https://www.esquire.com' },
  { name: 'The Paris Review', url: 'https://www.theparisreview.org' },

  // --- Sports -------------------------------------------------------------------------------------
  { name: 'ESPN', url: 'https://www.espn.com' },
  { name: 'The Athletic', url: 'https://theathletic.com' },
  { name: 'Sports Illustrated', url: 'https://www.si.com' },
  { name: 'Bleacher Report', url: 'https://bleacherreport.com' },
  { name: 'CBS Sports', url: 'https://www.cbssports.com' },
  { name: 'Yahoo Sports', url: 'https://sports.yahoo.com' },
  { name: 'SB Nation', url: 'https://www.sbnation.com' },
  { name: 'The Ringer', url: 'https://www.theringer.com' },

  // --- Entertainment & culture --------------------------------------------------------------------
  { name: 'Variety', url: 'https://variety.com' },
  { name: 'The Hollywood Reporter', url: 'https://www.hollywoodreporter.com' },
  { name: 'Rolling Stone', url: 'https://www.rollingstone.com' },
  { name: 'Pitchfork', url: 'https://pitchfork.com' },
  { name: 'Entertainment Weekly', url: 'https://ew.com' },
  { name: 'IndieWire', url: 'https://www.indiewire.com' },
  { name: 'Deadline', url: 'https://deadline.com' },
  { name: 'Vulture', url: 'https://www.vulture.com' },
  { name: 'The Wrap', url: 'https://www.thewrap.com' },
  { name: 'Billboard', url: 'https://www.billboard.com' },
  { name: 'Consequence', url: 'https://consequence.net' },
  { name: 'Stereogum', url: 'https://www.stereogum.com' },

  // --- International (English-language) -----------------------------------------------------------
  { name: 'BBC News', url: 'https://www.bbc.com/news' },
  { name: 'Al Jazeera English', url: 'https://www.aljazeera.com' },
  { name: 'The Independent', url: 'https://www.independent.co.uk' },
  { name: 'The Telegraph', url: 'https://www.telegraph.co.uk' },
  { name: 'Deutsche Welle (DW)', url: 'https://www.dw.com' },
  { name: 'France 24', url: 'https://www.france24.com' },
  { name: 'The Globe and Mail', url: 'https://www.theglobeandmail.com' },
  { name: 'CBC News', url: 'https://www.cbc.ca/news' },
  { name: 'The Sydney Morning Herald', url: 'https://www.smh.com.au' },
  { name: 'The Times of India', url: 'https://timesofindia.indiatimes.com' },

  // --- San Francisco Bay Area locals ------------------------------------------------------------
  { name: 'Alameda Post', url: 'https://alamedapost.com' },
  { name: 'San Francisco Chronicle (SFGate)', url: 'https://www.sfgate.com' },
  { name: 'San Francisco Chronicle', url: 'https://www.sfchronicle.com' },
  { name: 'Berkeleyside', url: 'https://www.berkeleyside.org' },
  { name: 'Mission Local', url: 'https://missionlocal.org' },
  { name: 'KQED', url: 'https://www.kqed.org' },
  { name: 'The Oaklandside', url: 'https://oaklandside.org' },
  { name: 'East Bay Times', url: 'https://www.eastbaytimes.com' },
  { name: 'The Mercury News (San Jose)', url: 'https://www.mercurynews.com' },
  { name: 'Palo Alto Online', url: 'https://www.paloaltoonline.com' },
  { name: 'Marin Independent Journal', url: 'https://www.marinij.com' },
  { name: 'Santa Cruz Sentinel', url: 'https://www.santacruzsentinel.com' },
  { name: 'Napa Valley Register', url: 'https://napavalleyregister.com' },
  { name: 'Sonoma Index-Tribune', url: 'https://www.sonomanews.com' },
  { name: 'San Francisco Examiner', url: 'https://www.sfexaminer.com' },
  { name: 'The San Francisco Standard', url: 'https://sfstandard.com' },
  { name: 'Local News Matters (Bay City News)', url: 'https://localnewsmatters.org' },
  { name: 'Richmond Confidential', url: 'https://richmondconfidential.org' },
  { name: 'Hoodline (San Francisco)', url: 'https://hoodline.com' },
  { name: 'SFist', url: 'https://sfist.com' },

  // --- Other major US metros not already covered above -------------------------------------------
  { name: 'The Austin American-Statesman', url: 'https://www.statesman.com' },
  { name: 'The Buffalo News', url: 'https://buffalonews.com' },
  { name: 'The Providence Journal', url: 'https://www.providencejournal.com' },
  { name: 'The Hartford Courant', url: 'https://www.courant.com' },
  { name: 'The Virginian-Pilot', url: 'https://www.pilotonline.com' },
  { name: 'The Post and Courier (Charleston)', url: 'https://www.postandcourier.com' },
  { name: 'Honolulu Star-Advertiser', url: 'https://www.staradvertiser.com' },
  { name: 'Anchorage Daily News', url: 'https://www.adn.com' },

  // --- Newsletters & aggregators --------------------------------------------------------------
  { name: 'Morning Brew', url: 'https://www.morningbrew.com' },
  { name: 'The Skimm', url: 'https://www.theskimm.com' },
  { name: 'Techmeme', url: 'https://www.techmeme.com' },
  { name: 'Longreads', url: 'https://longreads.com' },
  { name: 'Real Clear Markets', url: 'https://www.realclearmarkets.com' },
];
