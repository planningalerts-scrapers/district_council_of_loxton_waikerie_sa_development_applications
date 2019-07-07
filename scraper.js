// Parses the development applications at the South Australian District Council of Loxton Waikerie
// web site and places them in a database.
//
// Michael Bone
// 4th March 2019
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const cheerio = require("cheerio");
const request = require("request-promise-native");
const sqlite3 = require("sqlite3");
const moment = require("moment");
sqlite3.verbose();
const DevelopmentApplicationMainUrl = "https://eservices.loxtonwaikerie.sa.gov.au/eservice/daEnquiryInit.do?nodeNum=2811";
const DevelopmentApplicationSearchUrl = "https://eservices.loxtonwaikerie.sa.gov.au/eservice/daEnquiry.do?number=&lodgeRangeType=on&dateFrom={0}&dateTo={1}&detDateFromString=&detDateToString=&streetName=&suburb=0&unitNum=&houseNum=0%0D%0A%09%09%09%09%09&planNumber=&strataPlan=&lotNumber=&propertyName=&searchMode=A&submitButton=Search";
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
        ], function (error, row) {
            if (error) {
                console.error(error);
                reject(error);
            }
            else {
                console.log(`    Saved: application \"${developmentApplication.applicationNumber}\" with address \"${developmentApplication.address}\", description \"${developmentApplication.description}\" and received date \"${developmentApplication.receivedDate}\" into the database.`);
                sqlStatement.finalize(); // releases any locks
                resolve(row);
            }
        });
    });
}
// Gets the development applications for the specified date range.
async function getResults(dateFrom, dateTo) {
    let developmentApplications = [];
    // Ensure that a new JSESSIONID_live cookie value is allocated.
    console.log(`Retrieving page: ${DevelopmentApplicationMainUrl}`);
    let jar = request.jar(); // this cookie jar will end up containing the JSESSIONID_live cookie after the first request; the cookie is required for the second request
    await request({ url: DevelopmentApplicationMainUrl, jar: jar, rejectUnauthorized: false, proxy: process.env.MORPH_PROXY });
    await sleep(2000 + getRandom(0, 5) * 1000);
    // Retrieve the results of a search for the last month.
    let dateFromText = encodeURIComponent(dateFrom.format("DD/MM/YYYY"));
    let dateToText = encodeURIComponent(dateTo.format("DD/MM/YYYY"));
    let developmentApplicationSearchUrl = DevelopmentApplicationSearchUrl.replace(/\{0\}/g, dateFromText).replace(/\{1\}/g, dateToText);
    console.log(`Retrieving search results for: ${developmentApplicationSearchUrl}`);
    let body = await request({ url: developmentApplicationSearchUrl, jar: jar, rejectUnauthorized: false, proxy: process.env.MORPH_PROXY }); // the cookie jar contains the JSESSIONID_live cookie
    let $ = cheerio.load(body);
    // Parse the search results.
    for (let headerElement of $("h4.non_table_headers").get()) {
        let address = $(headerElement).text().trim().replace(/\s\s+/g, " "); // reduce multiple consecutive spaces in the address to a single space
        let applicationNumber = "";
        let description = "";
        let receivedDate = moment.invalid();
        for (let divElement of $(headerElement).next("div").get()) {
            for (let paragraphElement of $(divElement).find("p.rowDataOnly").get()) {
                let key = $(paragraphElement).children("span.key").text().trim();
                let value = $(paragraphElement).children("span.inputField").text().trim();
                if (key === "Type of Work")
                    description = value;
                else if (key === "Application No.") {
                    applicationNumber = value;
                    console.log(`Found development application "${applicationNumber}".`);
                }
                else if (key === "Date Lodged")
                    receivedDate = moment(value, "D/MM/YYYY", true); // allows the leading zero of the day to be omitted
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
function getRandom(minimum, maximum) {
    return Math.floor(Math.random() * (Math.floor(maximum) - Math.ceil(minimum))) + Math.ceil(minimum);
}
// Pauses for the specified number of milliseconds.
function sleep(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}
// Parses the development applications.
async function main() {
    // Ensure that the database exists.
    let database = await initializeDatabase();
    // Get the development applications for the last month.
    let developmentApplications = await getResults(moment().subtract(1, "months"), moment());
    console.log(`Inserting ${developmentApplications.length} development application(s) into the database.`);
    for (let developmentApplication of developmentApplications)
        await insertRow(database, developmentApplication);
    // Get the development applications for a random other month.
    let monthCount = moment().year() * 12 + moment().month() - (2012 * 12 + 1); // the first recorded development application is in 2012
    let randomMonth = getRandom(1, monthCount + 1);
    developmentApplications = await getResults(moment().subtract(randomMonth + 1, "months"), moment().subtract(randomMonth, "months"));
    console.log(`Inserting ${developmentApplications.length} development application(s) into the database.`);
    for (let developmentApplication of developmentApplications)
        await insertRow(database, developmentApplication);
}
main().then(() => console.log("Complete.")).catch(error => console.error(error));
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2NyYXBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInNjcmFwZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsa0dBQWtHO0FBQ2xHLDBDQUEwQztBQUMxQyxFQUFFO0FBQ0YsZUFBZTtBQUNmLGlCQUFpQjtBQUVqQixZQUFZLENBQUM7O0FBRWIsbUNBQW1DO0FBQ25DLGtEQUFrRDtBQUNsRCxtQ0FBbUM7QUFDbkMsaUNBQWlDO0FBRWpDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsQ0FBQztBQUVsQixNQUFNLDZCQUE2QixHQUFHLG1GQUFtRixDQUFDO0FBQzFILE1BQU0sK0JBQStCLEdBQUcsd1NBQXdTLENBQUM7QUFJalYsOEJBQThCO0FBRTlCLEtBQUssVUFBVSxrQkFBa0I7SUFDN0IsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNuQyxJQUFJLFFBQVEsR0FBRyxJQUFJLE9BQU8sQ0FBQyxRQUFRLENBQUMsYUFBYSxDQUFDLENBQUM7UUFDbkQsUUFBUSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEVBQUU7WUFDcEIsUUFBUSxDQUFDLEdBQUcsQ0FBQywwS0FBMEssQ0FBQyxDQUFDO1lBQ3pMLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUN0QixDQUFDLENBQUMsQ0FBQztJQUNQLENBQUMsQ0FBQyxDQUFDO0FBQ1AsQ0FBQztBQUVELG1FQUFtRTtBQUVuRSxLQUFLLFVBQVUsU0FBUyxDQUFDLFFBQVEsRUFBRSxzQkFBc0I7SUFDckQsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtRQUNuQyxJQUFJLFlBQVksR0FBRyxRQUFRLENBQUMsT0FBTyxDQUFDLHlEQUF5RCxDQUFDLENBQUM7UUFDL0YsWUFBWSxDQUFDLEdBQUcsQ0FBQztZQUNiLHNCQUFzQixDQUFDLGlCQUFpQjtZQUN4QyxzQkFBc0IsQ0FBQyxPQUFPO1lBQzlCLHNCQUFzQixDQUFDLFdB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