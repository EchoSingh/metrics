//Setup
export default async function({login, q, imports, data, account}, {enabled = false, extras = false} = {}) {
  try {
    //Check if the plugin is enabled and requirements are met
    if ((!q["16personalities"]) || (!imports.metadata.plugins["16personalities"].enabled(enabled, {extras})))
      return null

    //Load inputs
    let {url, sections, scores} = imports.metadata.plugins["16personalities"].inputs({data, account, q})
    if (!url)
      throw {error: {message: "URL is not set"}}

    //Start puppeteer and navigate to page
    console.debug(`metrics/compute/${login}/plugins > 16personalities > starting browser`)
    const browser = await imports.puppeteer.launch()
    console.debug(`metrics/compute/${login}/plugins > 16personalities > started ${await browser.version()}`)
    const page = await browser.newPage()
    console.debug(`metrics/compute/${login}/plugins > 16personalities > loading ${url}`)

    //Capture console messages from the browser context
    page.on("console", msg => {
      if (msg.type() === "debug") {
        console.debug(`BROWSER: ${msg.text()}`)
      }
    })

    await page.goto(url, {waitUntil: "networkidle2"})

    //Fetch raw data
    const raw = await page.evaluate(() => {
      const getInnerText = selector => document.querySelector(selector)?.innerText || ""

      //Default map personality category to RGB colors
      const defaultPersonalityColors = {
        explorers: "rgb(228, 174, 58)", //Virtuoso, Adventurer, Entrepreneur, Entertainer
        sentinels: "rgb(66, 152, 180)", //Logistician, Defender, Executive, Consul
        diplomats: "rgb(51, 164, 116)", //Advocate, Mediator, Protagonist, Campaigner
        analysts: "rgb(136, 97, 154)",  //Architect, Logician, Commander, Debater
        default: "rgb(0, 0, 0)"
      }
      let defaultColor = defaultPersonalityColors.default

      //Choose the default color based on the personality type
      const personalityType = getInnerText(".link--inline")
      if (personalityType.includes("Virtuoso") || personalityType.includes("Adventurer") || personalityType.includes("Entrepreneur") || personalityType.includes("Entertainer"))
        defaultColor = defaultPersonalityColors.explorers
      else if (personalityType.includes("Logistician") || personalityType.includes("Defender") || personalityType.includes("Executive") || personalityType.includes("Consul"))
        defaultColor = defaultPersonalityColors.sentinels
      else if (personalityType.includes("Advocate") || personalityType.includes("Mediator") || personalityType.includes("Protagonist") || personalityType.includes("Campaigner"))
        defaultColor = defaultPersonalityColors.diplomats
      else if (personalityType.includes("Architect") || personalityType.includes("Logician") || personalityType.includes("Commander") || personalityType.includes("Debater"))
        defaultColor = defaultPersonalityColors.analysts

      console.debug(`Personality Type: ${personalityType}`)

      return {
        //Type extraction
        type: getInnerText(".type__code"),

        //Personality details extraction
        personality: [...document.querySelectorAll(".slider__slides > div")].map(card => {
          //Extract image data
          let image = ""
          const cardElement = card.querySelector(".card__image")
          //Check if the card has an image as an url, e.g., the "His Role" image or the "His Strategy" image
          if (cardElement.querySelector("img")) {
            image = cardElement.querySelector("img").src
            console.debug(`Image for ${card.querySelector(".card__title")?.innerText}: ${image}`)
          }
          //Check if the card has a image as a svg, e.g., the "His personality" image
          else if (cardElement.querySelector("svg")) {
            image = new XMLSerializer().serializeToString(cardElement.querySelector("svg"))
            image = `data:image/svg+xml,${encodeURIComponent(image)}`
            console.debug(`Image for ${card.querySelector(".card__title")?.innerText} is a svg`)
          }

          return {
            category: card.querySelector(".card__title")?.innerText || "",      //Category, e.g., "His role"
            value: card.querySelector(".card__subtitle")?.innerText || "",      //Value of the category, e.g., "Sentinel"
            image,                                                              //Image of the category
            text: card.querySelector(".prevent--drag.card__p")?.innerText || "" //Description of the category
          }
        }),

        //Traits details extraction
        traits: [...document.querySelectorAll(".traits__boxes > div")].map(card => {
          const categoryText = card.querySelector(".traitbox__label")?.innerText
          const scoreText = card.querySelector(".traitbox__value")?.innerText.trim() //Get the text like "75% Extraverted"

          console.debug(`Parsing Trait category ${categoryText} ${scoreText}`)

          //Split the score text into percentage and trait
          const [percentage, ...traitArray] = scoreText.split(" ")

          //Return the traits details
          return {
            category: categoryText || "",                 //Trait category name, e.g., "Energy"
            value: traitArray.join(" ") || "",            //Extracted trait, e.g., "Extraverted"
            score: percentage || "",                      //Extracted percentage, e.g., "75%"
            text: card.querySelector("p").innerText || "" //Description of the trait
          }
        }),

        //Color
        color: document.querySelector(".card__bg") ? getComputedStyle(document.querySelector(".card__bg")).backgroundColor : defaultColor //eslint-disable-line no-undef
      }
    })

    //Format data
    const {color} = raw
    const type = raw.type.replace("(", "").replace(")", "").trim()
    const personality = await Promise.all(raw.personality.map(async ({category, value, image, text}) => ({
      category,
      value: value.replace(`(${type})`, "").trim(),
      image: image.startsWith("data:image/svg+xml,") ? image : await imports.imgb64(image),
      text: text.replace(`${category}\n${value}\n`, "").trim(),
    })))
    const traits = raw.traits.map(({category, value, score, text}) => ({
      category: category.replace(":", "").trim(),
      value: `${value[0]}${value.substring(1).toLocaleLowerCase()}`,
      score: scores ? Number(score.replace("%", "")) / 100 : NaN,
      text: text.trim()
    }))

    //Close browser
    await browser.close()

    //Results
    return {sections, color, type, personality, traits}
  }
  //Handle errors
  catch (error) {
    throw imports.format.error(error)
  }
}
