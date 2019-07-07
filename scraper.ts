// Parses the development applications at the South Australian District Council of Loxton Waikerie
// web site and places them in a database.
//
// Michael Bone
// 4th March 2019

"use strict";

import * as cheerio from "cheerio";
import * as request from "request-promise-native";
import * as sqlite3 from "sqlite3";
import * as moment from "moment";

sqlite3.verbose();

const DevelopmentApplicationMainUrl = "https://eservices.loxtonwaikerie.sa.gov.au/eservice/daEnquiryInit.do?nodeNum=2811";
const DevelopmentApplicationSearchUrl = "https://eservices.loxtonwaikerie.sa.gov.au/eservice/daEnquiry.do?number=&lodgeRangeType=on&dateFrom={0}&dateTo={1}&detDateFromString=&detDateToString=&streetName=&suburb=0&unitNum=&houseNum=0%0D%0A%09%09%09%09%09&planNumber=&strataPlan=&lotNumber=&propertyName=&searchMode=A&submitButton=Search";

declare const process: any;

// Sets up an sqlite database.

async function initializeDatabase() {
    return new Promise((resolve, reject) => {
        let database = new sqlite3.Database("data.sqlite");
        database.serialize(() => {
            database.run("create table if not exists [data] ([council_reference] text primary key, [address] text, [description] text, [info_url] text, [date_scraped] text, [date_received] text)");
            resolve(database);
        });
    });
}

// Inserts a row in the database if the row does not already exist.

async function insertRow(database, developmentApplication) {
    return new Promise((resolve, reject) => {
        let sqlStatement = database.prepare("insert or replace into [data] values (?, ?, ?, ?, ?, ?)");
        sqlStatement.run([
            developmentApplication.applicationNumber,
            developmentApplication.address,
            developmentApplication.description,
            developmentApplication.informationUrl,
            developmentApplication.scrapeDate,
            developmentApplication.receivedDate
        ], function(error, row) {
            if (error) {
                console.error(error);
                reject(error);
            } else {
                console.log(`    Saved: application \"${developmentApplication.applicationNumber}\" with address \"${developmentApplication.address}\", description \"${developmentApplication.description}\" and received date \"${developmentApplication.receivedDate}\" into the database.`);
                sqlStatement.finalize();  // releases any locks
                resolve(row);
            }
        });
    });
}

// Gets the development applications for the specified date range.

async function getResults(dateFrom: moment.Moment, dateTo: moment.Moment) {
    let developmentApplications = [];

    // Ensure that a new JSESSIONID_live cookie value is allocated.

    console.log(`Retrieving page: ${DevelopmentApplicationMainUrl}`);
    let jar = request.jar();  // this cookie jar will end up containing the JSESSIONID_live cookie after the first request; the cookie is required for the second request
    await request({ url: DevelopmentApplicationMainUrl, jar: jar, rejectUnauthorized: false, proxy: process.env.MORPH_PROXY });
    await sleep(2000 + getRandom(0, 5) * 1000);

    // Retrieve the results of a search for the last month.

    let dateFromText = encodeURIComponent(dateFrom.format("DD/MM/YYYY"));
    let dateToText = encodeURIComponent(dateTo.format("DD/MM/YYYY"));
    let developmentApplicationSearchUrl = DevelopmentApplicationSearchUrl.replace(/\{0\}/g, dateFromText).replace(/\{1\}/g, dateToText);
    console.log(`Retrieving search results for: ${developmentApplicationSearchUrl}`);
    let body = await request({ url: developmentApplicationSearchUrl, jar: jar, rejectUnauthorized: false, proxy: process.env.MORPH_PROXY });  // the cookie jar contains the JSESSIONID_live cookie
    let $ = cheerio.load(body);

    // Parse the search results.

    for (let headerElement of $("h4.non_table_headers").get()) {
        let address: string = $(headerElement).text().trim().replace(/\s\s+/g, " ");  // reduce multiple consecutive spaces in the address to a single space
        let applicationNumber = "";
        let description = "";
        let receivedDate = moment.invalid();

        for (let divElement of $(headerElement).next("div").get()) {
            for (let paragraphElement of $(divElement).find("p.rowDataOnly").get()) {
                let key: string = $(paragraphElement).children("span.key").text().trim();
                let value: string = $(paragraphElement).children("span.inputField").text().trim();
                if (key === "Type of Work")
                    description = value;
                else if (key === "Application No.") {
                    applicationNumber = value;
                    console.log(`Found development application "${applicationNumber}".`);
                }
                else if (key === "Date Lodged")
                    receivedDate = moment(value, "D/MM/YYYY", true);  // allows the leading zero of the day to be omitted
            }
        }

        // Ensure that at least an application number and address have been obtained.

        if (applicationNumber !== "" && address === "")
            console.log(`Ignoring development application "${applicationNumber}" because the address is blank.`);
        else if (applicationNumber !== "" && address !== "") {
            developmentApplications.push({
                applicationNumber: applicationNumber,
                address: address,
                description: ((description === "") ? "No Description Provided" : description),
                informationUrl: DevelopmentApplicationMainUrl,
                scrapeDate: moment().format("YYYY-MM-DD"),
                receivedDate: receivedDate.isValid() ? receivedDate.format("YYYY-MM-DD") : ""
            });
        }
    }

    return developmentApplications;
}

// Gets a random integer in the specified range: [minimum, maximum).

function getRandom(minimum: number, maximum: number) {
    return Math.floor(Math.random() * (Math.floor(maximum) - Math.ceil(minimum))) + Math.ceil(minimum);
}

// Pauses for the specified number of milliseconds.

function sleep(milliseconds: number) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

// Parses the development applications.

async function main() {
    // Ensure that the database exists.

    let database = await initializeDatabase();

    // Get the development applications for the last month.

    let developmentApplications = await getResults(moment().subtract(1, <moment.unitOfTime.DurationConstructor> "months"), moment());
    console.log(`Inserting ${developmentApplications.length} development application(s) into the database.`);
    for (let developmentApplication of developmentApplications)
        await insertRow(database, developmentApplication);

    // Get the development applications for a random other month.

    let monthCount = moment().year() * 12 + moment().month() - (2012 * 12 + 1);  // the first recorded development application is in 2012
    let randomMonth = getRandom(1, monthCount + 1)

    developmentApplications = await getResults(moment().subtract(randomMonth + 1, <moment.unitOfTime.DurationConstructor> "months"), moment().subtract(randomMonth, <moment.unitOfTime.DurationConstructor> "months"));
    console.log(`Inserting ${developmentApplications.length} development application(s) into the database.`);
    for (let developmentApplication of developmentApplications)
        await insertRow(database, developmentApplication);
}

main().then(() => console.log("Complete.")).catch(error => console.error(error));
