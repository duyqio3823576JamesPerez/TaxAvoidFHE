// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract TaxAvoidFHE is SepoliaConfig {
    struct EncryptedFinancialReport {
        uint256 id;
        euint32 encryptedRevenue; // Encrypted revenue data
        euint32 encryptedExpenses; // Encrypted expenses data
        euint32 encryptedTaxData; // Encrypted tax-related data
        string companyIdentifier; // Public company identifier
        uint256 timestamp;
    }
    
    struct DecryptedFinancialReport {
        string revenue;
        string expenses;
        string taxData;
        bool isRevealed;
    }

    struct TaxAnalysisResult {
        uint256 reportId;
        euint32 encryptedRiskScore; // Encrypted tax avoidance risk score
        string analysisMethod;
        uint256 timestamp;
    }

    uint256 public reportCount;
    uint256 public analysisCount;
    
    mapping(uint256 => EncryptedFinancialReport) public encryptedReports;
    mapping(uint256 => DecryptedFinancialReport) public decryptedReports;
    mapping(uint256 => TaxAnalysisResult) public analysisResults;
    
    mapping(string => euint32) private encryptedIndustryRisk;
    string[] private industryList;
    
    mapping(uint256 => uint256) private requestToReportId;
    
    event ReportSubmitted(uint256 indexed id, string companyId, uint256 timestamp);
    event AnalysisCompleted(uint256 indexed reportId, uint256 resultId);
    event DecryptionRequested(uint256 indexed id);
    event ReportDecrypted(uint256 indexed id);
    event RiskThresholdExceeded(uint256 reportId, string riskLevel);
    
    modifier onlyAuditor(uint256 reportId) {
        _;
    }
    
    function submitEncryptedReport(
        euint32 encryptedRevenue,
        euint32 encryptedExpenses,
        euint32 encryptedTaxData,
        string memory companyId
    ) public {
        reportCount += 1;
        uint256 newId = reportCount;
        
        encryptedReports[newId] = EncryptedFinancialReport({
            id: newId,
            encryptedRevenue: encryptedRevenue,
            encryptedExpenses: encryptedExpenses,
            encryptedTaxData: encryptedTaxData,
            companyIdentifier: companyId,
            timestamp: block.timestamp
        });
        
        decryptedReports[newId] = DecryptedFinancialReport({
            revenue: "",
            expenses: "",
            taxData: "",
            isRevealed: false
        });
        
        emit ReportSubmitted(newId, companyId, block.timestamp);
    }
    
    function performTaxAnalysis(
        uint256 reportId,
        euint32 encryptedRiskScore,
        string memory analysisMethod
    ) public onlyAuditor(reportId) {
        analysisCount += 1;
        uint256 newId = analysisCount;
        
        analysisResults[newId] = TaxAnalysisResult({
            reportId: reportId,
            encryptedRiskScore: encryptedRiskScore,
            analysisMethod: analysisMethod,
            timestamp: block.timestamp
        });
        
        emit AnalysisCompleted(reportId, newId);
    }
    
    function requestReportDecryption(uint256 reportId) public onlyAuditor(reportId) {
        EncryptedFinancialReport storage report = encryptedReports[reportId];
        require(!decryptedReports[reportId].isRevealed, "Already decrypted");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(report.encryptedRevenue);
        ciphertexts[1] = FHE.toBytes32(report.encryptedExpenses);
        ciphertexts[2] = FHE.toBytes32(report.encryptedTaxData);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptReport.selector);
        requestToReportId[reqId] = reportId;
        
        emit DecryptionRequested(reportId);
    }
    
    function decryptReport(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 reportId = requestToReportId[requestId];
        require(reportId != 0, "Invalid request");
        
        DecryptedFinancialReport storage dReport = decryptedReports[reportId];
        require(!dReport.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        string[] memory results = abi.decode(cleartexts, (string[]));
        
        dReport.revenue = results[0];
        dReport.expenses = results[1];
        dReport.taxData = results[2];
        dReport.isRevealed = true;
        
        string memory industry = extractIndustryFromId(encryptedReports[reportId].companyIdentifier);
        if (FHE.isInitialized(encryptedIndustryRisk[industry]) == false) {
            encryptedIndustryRisk[industry] = FHE.asEuint32(0);
            industryList.push(industry);
        }
        
        emit ReportDecrypted(reportId);
    }
    
    function flagHighRiskReport(uint256 reportId, string memory riskLevel) public onlyAuditor(reportId) {
        require(decryptedReports[reportId].isRevealed, "Report not decrypted");
        
        emit RiskThresholdExceeded(reportId, riskLevel);
    }
    
    function getDecryptedReport(uint256 reportId) public view returns (
        string memory revenue,
        string memory expenses,
        string memory taxData,
        bool isRevealed
    ) {
        DecryptedFinancialReport storage r = decryptedReports[reportId];
        return (r.revenue, r.expenses, r.taxData, r.isRevealed);
    }
    
    function getAnalysisResult(uint256 resultId) public view returns (
        uint256 reportId,
        string memory analysisMethod,
        uint256 timestamp
    ) {
        TaxAnalysisResult storage r = analysisResults[resultId];
        return (r.reportId, r.analysisMethod, r.timestamp);
    }
    
    function getEncryptedIndustryRisk(string memory industry) public view returns (euint32) {
        return encryptedIndustryRisk[industry];
    }
    
    function requestIndustryRiskDecryption(string memory industry) public {
        euint32 riskScore = encryptedIndustryRisk[industry];
        require(FHE.isInitialized(riskScore), "Industry not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(riskScore);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptIndustryRisk.selector);
        requestToReportId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(industry)));
    }
    
    function decryptIndustryRisk(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 industryHash = requestToReportId[requestId];
        string memory industry = getIndustryFromHash(industryHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 riskScore = abi.decode(cleartexts, (uint32));
    }
    
    function extractIndustryFromId(string memory companyId) private pure returns (string memory) {
        bytes memory idBytes = bytes(companyId);
        if (idBytes.length >= 2) {
            return string(abi.encodePacked(idBytes[0], idBytes[1]));
        }
        return "OTHER";
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getIndustryFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < industryList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(industryList[i]))) == hash) {
                return industryList[i];
            }
        }
        revert("Industry not found");
    }
}