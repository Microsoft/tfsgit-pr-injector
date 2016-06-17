/// <reference path="../../typings/index.d.ts" />

import fs = require('fs');
import util = require('util');

import * as ext from './Extensions.ts';

import { PRInjectorError } from './PRInjectorError';
import { Message } from './Message';
import { ILogger } from './ILogger';


/**
 * Responsible for processing a SonarQube report to extract code analysis issues from it
 * 
 * @export
 * @class SonarQubeReportProcessor
 */
export class SonarQubeReportProcessor {

    private logger: ILogger;

    constructor(logger: ILogger) {
        if (!logger) {
            throw new ReferenceError('logger');
        }

        this.logger = logger;
    }

    /**
     * Extracts the messages to be posted from a SonarQube report file
     * 
     * @param {string} reportPath (description)
     * @returns {Message[]} (description)
     */
    public FetchCommentsFromReport(reportPath: string): Message[] {

        if (!reportPath) {
            throw new ReferenceError('Report path is null or empty');
        }

        try {
            fs.accessSync(reportPath, fs.F_OK);
        } catch (e) {
            throw new PRInjectorError('Could not find ' + reportPath + ' - did the SonarQube analysis complete?');
        }

        let sqReportContent: string = fs.readFileSync(reportPath, 'utf8');
        var sonarQubeReport: any;

        try {
            sonarQubeReport = JSON.parse(sqReportContent);
        } catch (e) {
            throw new PRInjectorError('Could not parse the SonarQube report file. The error is: ' + e.message);
        }

        let componentMap = this.BuildComponentMap(sonarQubeReport);
        return this.BuildMessages(sonarQubeReport, componentMap);
    }

    private BuildComponentMap(sonarQubeReport: any): ext.Map<string> {
        let map: ext.Map<string> = {};

        if (!sonarQubeReport.components) {
            this.logger.LogInfo('The SonarQube report is empty as it lists no components');
            return map;
        }

        for (var component of sonarQubeReport.components) {
            if (!component.key) {
                throw new PRInjectorError('Invalid SonarQube report - some components do not have keys');
            }

            if (component.path) {
                map[component.key] = component.path;
            }
        }

        this.logger.LogDebug(
            util.format(
                'The SonarQube report contains %d components with paths',
                Object.keys(map).length));

        return map;
    }

    private BuildMessages(sonarQubeReport: any, componentMap: ext.Map<string>): Message[] {

        let messages: Message[] = [];

        // no components, i.e. empty report
        if (Object.keys(componentMap).length === 0) {
            return messages;
        }

        if (!sonarQubeReport.issues) {
            this.logger.LogInfo('The SonarQube report is empty as there are no issues');
            return messages;
        }

        let issueCount: number = sonarQubeReport.issues.length;
        let newIssues = sonarQubeReport.issues.filter((issue: any) => {
            return issue.isNew === true;
        });

        this.logger.LogInfo(
            util.format('The SonarQube report contains %d issues, out of which %d are new.', issueCount, newIssues.length)
        );

        for (var issue of newIssues) {
            let issueComponent = issue.component;

            if (!issueComponent) {
                throw new PRInjectorError(
                    util.format('Invalid SonarQube report - an issue does not have the component attribute. Content "%s"', issue.content));
            }

            let path: string = componentMap[issueComponent];

            if (!path) {
                throw new PRInjectorError(
                    util.format('Invalid SonarQube report - an issue belongs to an invalid component. Content "%s"', issue.content));
            }

            let message: Message = this.BuildMessage(path, issue);

            if (message) {
                messages.push(message);
            }

        }

        return messages;
    }

    // todo: filter out assembly level issues ?
    private BuildMessage(path: string, issue: any): Message {

        // todo: more checks for rule and message 
        let content: string = util.format('%s (%s)', issue.message, issue.rule);
        let priority: number = this.GetPriority(issue);

        if (!issue.line) {
            this.logger.LogWarning(
                util.format(
                    'A SonarQube issue does not have an associated line and will be ignored. File "%s". Content "%s". ',
                    content,
                    path));

            return null;
        }

        let line: number = issue.line;

        if (line < 1) {
            this.logger.LogWarning(
                util.format(
                    'A SonarQube issue was reported on line %d and will be ignored. File "%s". Content "%s".',
                    line,
                    path,
                    content));

            return null;
        }

        let message: Message = new Message(content, path, line, priority);
        return message;
    }

    private GetPriority(issue: any) {

        let severity: string = issue.severity;
        if (!severity) {
            this.logger.LogDebug(util.format('Issue %d does not have a priority associated', issue.content));
            severity = 'none';
        }

        switch (severity.toLowerCase()) {
            case 'blocker':
                return 1;
            case 'critical':
                return 2;
            case 'major':
                return 3;
            case 'minor':
                return 4;
            case 'info':
                return 5;
            default:
                return 6;
        }
    }
}


