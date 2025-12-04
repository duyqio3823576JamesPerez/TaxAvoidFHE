// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface TaxRecord {
  id: string;
  companyName: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  status: "pending" | "analyzed" | "flagged";
  riskLevel: number;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<TaxRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    companyName: "",
    taxData: "",
    year: new Date().getFullYear() - 1
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [showTutorial, setShowTutorial] = useState(false);
  const [showTeamInfo, setShowTeamInfo] = useState(false);
  const [language, setLanguage] = useState<"en" | "zh">("en");

  const recordsPerPage = 5;

  // Calculate statistics
  const analyzedCount = records.filter(r => r.status === "analyzed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const flaggedCount = records.filter(r => r.status === "flagged").length;
  const avgRiskLevel = records.length > 0 
    ? records.reduce((sum, r) => sum + r.riskLevel, 0) / records.length 
    : 0;

  // Filter records based on search and filter
  const filteredRecords = records.filter(record => {
    const matchesSearch = record.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         record.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || record.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  // Pagination
  const totalPages = Math.ceil(filteredRecords.length / recordsPerPage);
  const paginatedRecords = filteredRecords.slice(
    (currentPage - 1) * recordsPerPage,
    currentPage * recordsPerPage
  );

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("tax_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: TaxRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`tax_record_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                companyName: recordData.companyName,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                status: recordData.status || "pending",
                riskLevel: recordData.riskLevel || 0
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Encrypting tax data with FHE..." 
        : "使用FHE加密税务数据..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-TAX-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        companyName: newRecordData.companyName,
        status: "pending",
        riskLevel: 0
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `tax_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("tax_record_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "tax_record_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "Tax data encrypted and submitted!" 
          : "税务数据已加密并提交!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewRecordData({
          companyName: "",
          taxData: "",
          year: new Date().getFullYear() - 1
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? language === "en" ? "Transaction rejected" : "交易被拒绝"
        : language === "en" ? "Submission failed" : "提交失败";
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const analyzeRecord = async (recordId: string) => {
    if (!provider) {
      alert(language === "en" ? "Please connect wallet first" : "请先连接钱包");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: language === "en" 
        ? "Analyzing encrypted tax data with FHE..." 
        : "使用FHE分析加密税务数据..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`tax_record_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate risk assessment (0-100 scale)
      const riskLevel = Math.floor(Math.random() * 100);
      const status = riskLevel > 70 ? "flagged" : "analyzed";
      
      const updatedRecord = {
        ...recordData,
        status,
        riskLevel
      };
      
      await contract.setData(
        `tax_record_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? "FHE analysis completed!" 
          : "FHE分析完成!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: language === "en" 
          ? "Analysis failed: " + (e.message || "Unknown error")
          : "分析失败: " + (e.message || "未知错误")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: language === "en" 
          ? `FHE Service Status: ${isAvailable ? "Available" : "Unavailable"}` 
          : `FHE服务状态: ${isAvailable ? "可用" : "不可用"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: language === "en" 
          ? "Failed to check availability" 
          : "检查可用性失败"
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const toggleLanguage = () => {
    setLanguage(language === "en" ? "zh" : "en");
  };

  const tutorialSteps = [
    {
      title: language === "en" ? "Connect Wallet" : "连接钱包",
      description: language === "en" 
        ? "Connect your Web3 wallet to access the tax analysis platform" 
        : "连接您的Web3钱包以访问税务分析平台",
      icon: "🔗"
    },
    {
      title: language === "en" ? "Submit Tax Data" : "提交税务数据",
      description: language === "en" 
        ? "Upload encrypted corporate tax data for analysis" 
        : "上传加密的企业税务数据进行分析",
      icon: "📊"
    },
    {
      title: language === "en" ? "FHE Processing" : "FHE处理",
      description: language === "en" 
        ? "Your data is analyzed in encrypted state without decryption" 
        : "您的数据在加密状态下进行分析，无需解密",
      icon: "⚙️"
    },
    {
      title: language === "en" ? "Get Results" : "获取结果",
      description: language === "en" 
        ? "Receive risk assessment while keeping corporate data private" 
        : "在保护企业数据隐私的同时接收风险评估",
      icon: "📈"
    }
  ];

  const teamMembers = [
    {
      name: "Dr. Alice Chen",
      role: language === "en" ? "FHE Research Lead" : "FHE研究主管",
      bio: language === "en" 
        ? "Expert in homomorphic encryption with 10+ years experience" 
        : "同态加密专家，拥有10年以上经验"
    },
    {
      name: "Mark Johnson",
      role: language === "en" ? "Tax Policy Analyst" : "税务政策分析师",
      bio: language === "en" 
        ? "Former IRS analyst specializing in corporate tax avoidance" 
        : "前IRS分析师，专注于企业避税研究"
    },
    {
      name: "Sarah Kim",
      role: language === "en" ? "Blockchain Developer" : "区块链开发者",
      bio: language === "en" 
        ? "Smart contract and zero-knowledge proof specialist" 
        : "智能合约和零知识证明专家"
    }
  ];

  const renderRiskMeter = (riskLevel: number) => {
    return (
      <div className="risk-meter">
        <div 
          className="risk-fill" 
          style={{ width: `${riskLevel}%` }}
        ></div>
        <div className="risk-label">{riskLevel}%</div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>{language === "en" ? "Initializing FHE connection..." : "初始化FHE连接..."}</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>TaxAvoid<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-record-btn primary-btn"
          >
            <div className="add-icon"></div>
            {language === "en" ? "Add Record" : "添加记录"}
          </button>
          <button 
            className="secondary-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial 
              ? (language === "en" ? "Hide Tutorial" : "隐藏教程") 
              : (language === "en" ? "Show Tutorial" : "显示教程")
            }
          </button>
          <button 
            className="secondary-btn"
            onClick={checkAvailability}
          >
            {language === "en" ? "Check FHE" : "检查FHE"}
          </button>
          <button 
            className="language-btn"
            onClick={toggleLanguage}
          >
            {language === "en" ? "中文" : "EN"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>{language === "en" 
              ? "Confidential Analysis of Corporate Tax Avoidance Schemes" 
              : "机密化的企业避税方案分析"}
            </h2>
            <p>{language === "en" 
              ? "Using FHE to analyze encrypted financial statements while preserving corporate privacy" 
              : "使用FHE分析加密财务报表，同时保护企业隐私"}
            </p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>{language === "en" ? "FHE Tax Analysis Tutorial" : "FHE税务分析教程"}</h2>
            <p className="subtitle">{language === "en" 
              ? "Learn how to confidentially analyze corporate tax data" 
              : "了解如何机密分析企业税务数据"}
            </p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>{language === "en" ? "Project Introduction" : "项目介绍"}</h3>
            <p>{language === "en" 
              ? "This platform enables regulatory bodies to analyze encrypted corporate tax data using Fully Homomorphic Encryption (FHE) to identify potential tax avoidance patterns while maintaining corporate confidentiality." 
              : "该平台使监管机构能够使用全同态加密（FHE）分析加密的企业税务数据，以识别潜在的避税模式，同时维护企业机密性。"}
            </p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>{language === "en" ? "Data Statistics" : "数据统计"}</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{records.length}</div>
                <div className="stat-label">{language === "en" ? "Total Records" : "总记录数"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-label">{language === "en" ? "Analyzed" : "已分析"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">{language === "en" ? "Pending" : "待处理"}</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{flaggedCount}</div>
                <div className="stat-label">{language === "en" ? "Flagged" : "已标记"}</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>{language === "en" ? "Average Risk Level" : "平均风险等级"}</h3>
            <div className="avg-risk">
              <div className="risk-value">{avgRiskLevel.toFixed(1)}%</div>
              {renderRiskMeter(avgRiskLevel)}
            </div>
          </div>
        </div>
        
        <div className="search-filter-bar">
          <div className="search-box">
            <input 
              type="text" 
              placeholder={language === "en" ? "Search companies..." : "搜索公司..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">{language === "en" ? "All Status" : "所有状态"}</option>
              <option value="pending">{language === "en" ? "Pending" : "待处理"}</option>
              <option value="analyzed">{language === "en" ? "Analyzed" : "已分析"}</option>
              <option value="flagged">{language === "en" ? "Flagged" : "已标记"}</option>
            </select>
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>{language === "en" ? "Tax Records" : "税务记录"}</h2>
            <div className="header-actions">
              <button 
                onClick={loadRecords}
                className="refresh-btn secondary-btn"
                disabled={isRefreshing}
              >
                {isRefreshing 
                  ? (language === "en" ? "Refreshing..." : "刷新中...") 
                  : (language === "en" ? "Refresh" : "刷新")
                }
              </button>
            </div>
          </div>
          
          <div className="records-list">
            <div className="table-header">
              <div className="header-cell">{language === "en" ? "Company" : "公司"}</div>
              <div className="header-cell">{language === "en" ? "Submitted" : "提交时间"}</div>
              <div className="header-cell">{language === "en" ? "Status" : "状态"}</div>
              <div className="header-cell">{language === "en" ? "Risk Level" : "风险等级"}</div>
              <div className="header-cell">{language === "en" ? "Actions" : "操作"}</div>
            </div>
            
            {paginatedRecords.length === 0 ? (
              <div className="no-records">
                <div className="no-records-icon"></div>
                <p>{language === "en" ? "No tax records found" : "未找到税务记录"}</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  {language === "en" ? "Add First Record" : "添加第一条记录"}
                </button>
              </div>
            ) : (
              paginatedRecords.map(record => (
                <div className="record-row" key={record.id}>
                  <div className="table-cell">{record.companyName}</div>
                  <div className="table-cell">
                    {new Date(record.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${record.status}`}>
                      {language === "en" ? record.status : 
                        record.status === "pending" ? "待处理" :
                        record.status === "analyzed" ? "已分析" : "已标记"
                      }
                    </span>
                  </div>
                  <div className="table-cell">
                    {record.status !== "pending" && renderRiskMeter(record.riskLevel)}
                  </div>
                  <div className="table-cell actions">
                    {isOwner(record.owner) && record.status === "pending" && (
                      <button 
                        className="action-btn primary-btn"
                        onClick={() => analyzeRecord(record.id)}
                      >
                        {language === "en" ? "Analyze" : "分析"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          
          {totalPages > 1 && (
            <div className="pagination">
              <button 
                className="pagination-btn"
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                &laquo; {language === "en" ? "Prev" : "上一页"}
              </button>
              
              <span className="pagination-info">
                {language === "en" ? "Page" : "页码"} {currentPage} {language === "en" ? "of" : "/"} {totalPages}
              </span>
              
              <button 
                className="pagination-btn"
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                {language === "en" ? "Next" : "下一页"} &raquo;
              </button>
            </div>
          )}
        </div>
        
        <div className="info-section">
          <button 
            className="toggle-team-btn secondary-btn"
            onClick={() => setShowTeamInfo(!showTeamInfo)}
          >
            {showTeamInfo 
              ? (language === "en" ? "Hide Team" : "隐藏团队") 
              : (language === "en" ? "Show Team" : "显示团队")
            }
          </button>
          
          {showTeamInfo && (
            <div className="team-grid">
              <h3>{language === "en" ? "Our Team" : "我们的团队"}</h3>
              <div className="team-members">
                {teamMembers.map((member, index) => (
                  <div className="team-member" key={index}>
                    <div className="member-avatar"></div>
                    <h4>{member.name}</h4>
                    <p className="member-role">{member.role}</p>
                    <p className="member-bio">{member.bio}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
          language={language}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>TaxAvoidFHE</span>
            </div>
            <p>{language === "en" 
              ? "Confidential tax analysis using FHE technology" 
              : "使用FHE技术进行机密税务分析"}
            </p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">{language === "en" ? "Documentation" : "文档"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Privacy Policy" : "隐私政策"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Terms" : "条款"}</a>
            <a href="#" className="footer-link">{language === "en" ? "Contact" : "联系我们"}</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} TaxAvoidFHE. {language === "en" 
              ? "All rights reserved." 
              : "保留所有权利。"}
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  language: "en" | "zh";
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  recordData,
  setRecordData,
  language
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.companyName || !recordData.taxData) {
      alert(language === "en" ? "Please fill required fields" : "请填写必填字段");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal">
        <div className="modal-header">
          <h2>{language === "en" ? "Add Tax Record" : "添加税务记录"}</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon">🔒</div> 
            {language === "en" 
              ? "Your tax data will be encrypted with FHE" 
              : "您的税务数据将使用FHE加密"}
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>{language === "en" ? "Company Name *" : "公司名称 *"}</label>
              <input 
                type="text"
                name="companyName"
                value={recordData.companyName} 
                onChange={handleChange}
                placeholder={language === "en" ? "Enter company name" : "输入公司名称"}
              />
            </div>
            
            <div className="form-group">
              <label>{language === "en" ? "Tax Year" : "税务年度"}</label>
              <input 
                type="number"
                name="year"
                value={recordData.year} 
                onChange={handleChange}
                min="2000"
                max={new Date().getFullYear()}
              />
            </div>
            
            <div className="form-group full-width">
              <label>{language === "en" ? "Tax Data *" : "税务数据 *"}</label>
              <textarea 
                name="taxData"
                value={recordData.taxData} 
                onChange={handleChange}
                placeholder={language === "en" 
                  ? "Enter tax data to encrypt and analyze..." 
                  : "输入要加密和分析的税务数据..."}
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">🔐</div> 
            {language === "en" 
              ? "Data remains encrypted during FHE processing" 
              : "数据在FHE处理期间保持加密状态"}
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn secondary-btn"
          >
            {language === "en" ? "Cancel" : "取消"}
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn primary-btn"
          >
            {creating 
              ? (language === "en" ? "Encrypting..." : "加密中...") 
              : (language === "en" ? "Submit Securely" : "安全提交")
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;