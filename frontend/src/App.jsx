import { useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import Auth from './Auth';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  ChevronRight,
  ClipboardList,
  Database,
  FileSearch,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  LogOut,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Settings,
  Stethoscope,
  UploadCloud,
} from 'lucide-react';

const API_BASE_URL = 'http://localhost:5003';
const DEFAULT_GREETING = 'Hello! I am MedInsight. How can I help you analyze your reports today?';

function formatAnswer(answer, options = {}) {
  const { includeDisclaimer = true } = options;

  if (typeof answer === 'string') return answer;

  if (answer?.answer) {
    const parts = [];
    if (answer.medicalContext === 'report_interpretation') {
      parts.push('Mode: Report interpretation');
    } else if (answer.medicalContext === 'educational_info') {
      parts.push('Mode: Educational information');
    } else if (answer.medicalContext === 'mixed') {
      parts.push('Mode: Report interpretation + educational information');
    } else if (answer.medicalContext === 'out_of_scope') {
      parts.push('Mode: Outside report scope');
    } else if (answer.medicalContext === 'safety_refusal') {
      parts.push('Mode: Safety refusal');
    }

    parts.push(answer.answer);

    if (answer.emergencyWarning) {
      parts.push(answer.emergencyWarning);
    }

    if (answer.knowledgeBaseNotice) {
      parts.push(answer.knowledgeBaseNotice);
    }

    if (answer.disclaimer && includeDisclaimer) {
      parts.push(answer.disclaimer);
    }

    if (Array.isArray(answer.followUpQuestions) && answer.followUpQuestions.length > 0) {
      parts.push(`Follow-up questions:\n${answer.followUpQuestions.map((item) => `- ${item}`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  return 'I received a response, but could not display it.';
}

function getApiErrorMessage(error) {
  return error.response?.data?.details || error.response?.data?.message || error.message;
}

function getKnowledgeReadinessLabel(status) {
  if (!status) return 'Checking';
  if (status.ready) return 'Ready';
  if (status.chunkCount === 0) return 'Syncing';
  return 'Not Ready';
}

function getReportId(report) {
  return report?._id || report?.id || '';
}

function getReportTitle(report) {
  return report?.reportType || report?.originalFileName || 'Medical report';
}

function getReportSubtitle(report) {
  if (!report?.originalFileName) return 'Uploaded report';
  return report.originalFileName.replace(/\.pdf$/i, '');
}

function formatDate(value) {
  if (!value) return 'Unknown date';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value));
}

function normalizeReportChat(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return [{ role: 'ai', content: DEFAULT_GREETING }];
  }

  return [
    { role: 'ai', content: DEFAULT_GREETING },
    ...history.flatMap((item) => [
      { role: 'user', content: item.question || '' },
      { role: 'ai', content: item.answer || 'No answer saved for this message.' },
    ]),
  ];
}

function countReportsWithFindings(reports) {
  return reports.filter((report) => {
    const abnormalValues = Array.isArray(report.abnormalValues) ? report.abnormalValues : [];
    const parameters = Array.isArray(report.parameters) ? report.parameters : [];
    return abnormalValues.length > 0 || parameters.some((item) => item.status && item.status.toLowerCase() !== 'normal');
  }).length;
}

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('medinsight_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

function App() {
  const [token, setToken] = useState(localStorage.getItem('medinsight_token'));

  return (
    <Router>
      <Routes>
        <Route path="/login" element={!token ? <Auth setToken={setToken} /> : <Navigate to="/" />} />
        <Route path="/" element={token ? <Dashboard setToken={setToken} /> : <Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

function Dashboard({ setToken }) {
  const [activeSection, setActiveSection] = useState('dashboard');
  const [question, setQuestion] = useState('');
  const [globalChatHistory, setGlobalChatHistory] = useState([{ role: 'ai', content: DEFAULT_GREETING }]);
  const [reportChatHistory, setReportChatHistory] = useState([{ role: 'ai', content: DEFAULT_GREETING }]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [hasShownMedicalDisclaimer, setHasShownMedicalDisclaimer] = useState(false);
  const [knowledgeStatus, setKnowledgeStatus] = useState(null);
  const [isRefreshingKnowledge, setIsRefreshingKnowledge] = useState(false);
  const [isSyncingKnowledge, setIsSyncingKnowledge] = useState(false);
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const fileInputRef = useRef(null);
  const selectedReportId = getReportId(selectedReport);
  const hasReportContext = activeSection === 'reports' && Boolean(selectedReportId);
  const activeChatHistory = hasReportContext ? reportChatHistory : globalChatHistory;
  const filteredReports = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return reports;
    return reports.filter((report) => {
      const searchable = [
        report.originalFileName,
        report.reportType,
        report.summary,
        ...(Array.isArray(report.abnormalValues) ? report.abnormalValues : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(term);
    });
  }, [reports, searchTerm]);

  const dashboardStats = useMemo(() => {
    const now = new Date();
    const thisMonth = reports.filter((report) => {
      const created = new Date(report.createdAt);
      return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
    }).length;

    return {
      totalReports: reports.length,
      thisMonth,
      reportsWithFindings: countReportsWithFindings(reports),
      knowledgeLabel: getKnowledgeReadinessLabel(knowledgeStatus),
    };
  }, [knowledgeStatus, reports]);

  const refreshKnowledgeStatus = async () => {
    setIsRefreshingKnowledge(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/reports/knowledge-base/status`);
      setKnowledgeStatus(response.data.status);
    } catch (error) {
      setKnowledgeStatus({
        ready: false,
        provider: 'knowledge_base',
        lastError: getApiErrorMessage(error),
      });
    } finally {
      setIsRefreshingKnowledge(false);
    }
  };

  const loadReports = async ({ preserveSelection = true, selectionId = selectedReportId } = {}) => {
    setIsLoadingReports(true);
    try {
      const response = await axios.get(`${API_BASE_URL}/api/reports?limit=50`);
      const nextReports = Array.isArray(response.data) ? response.data : [];
      setReports(nextReports);

      if (!preserveSelection && nextReports.length > 0) {
        await selectReport(nextReports[0], { switchSection: false });
      } else if (preserveSelection && selectionId) {
        const freshSelected = nextReports.find((report) => getReportId(report) === selectionId);
        if (freshSelected) setSelectedReport(freshSelected);
      } else if (!selectionId && nextReports.length > 0) {
        await selectReport(nextReports[0], { switchSection: false });
      }
    } catch (error) {
      setReportChatHistory((prev) => [
        ...prev,
        { role: 'ai', content: `Could not load report history. ${getApiErrorMessage(error)}` },
      ]);
    } finally {
      setIsLoadingReports(false);
    }
  };

  useEffect(() => {
    refreshKnowledgeStatus();
    loadReports({ preserveSelection: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('medinsight_token');
    setToken(null);
  };

  const selectReport = async (report, options = {}) => {
    const { switchSection = true } = options;
    const reportId = getReportId(report);
    if (!reportId) return;

    setSelectedReport(report);
    setHasShownMedicalDisclaimer(false);
    if (switchSection) setActiveSection('reports');

    try {
      const [detailResponse, historyResponse] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/reports/${reportId}`),
        axios.get(`${API_BASE_URL}/api/reports/${reportId}/chat-history`),
      ]);
      setSelectedReport(detailResponse.data);
      setReportChatHistory(normalizeReportChat(historyResponse.data));
    } catch (error) {
      setReportChatHistory([
        { role: 'ai', content: DEFAULT_GREETING },
        { role: 'ai', content: `I selected this report, but could not load its saved chat. ${getApiErrorMessage(error)}` },
      ]);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploadStatus(null);
    setIsUploading(true);

    const formData = new FormData();
    formData.append('report', file);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/reports/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const report = response.data?.report;

      setUploadStatus('success');
      setSelectedReport(report);
      setActiveSection('reports');
      setHasShownMedicalDisclaimer(false);
      setReportChatHistory([
        { role: 'ai', content: DEFAULT_GREETING },
        { role: 'ai', content: `I've successfully processed "${file.name}". You can now ask me questions about it!` },
      ]);
      await loadReports({ preserveSelection: true, selectionId: getReportId(report) });
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus('error');
      setReportChatHistory((prev) => [
        ...prev,
        { role: 'ai', content: `Upload failed. ${getApiErrorMessage(error)}` },
      ]);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSyncKnowledgeBase = async () => {
    setIsSyncingKnowledge(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/reports/knowledge-base/sync`, {});
      setKnowledgeStatus(response.data.status);
      setGlobalChatHistory((prev) => [...prev, { role: 'ai', content: 'Knowledge base synced successfully.' }]);
    } catch (error) {
      const message = getApiErrorMessage(error);
      setGlobalChatHistory((prev) => [...prev, { role: 'ai', content: `Knowledge base sync failed. ${message}` }]);
      await refreshKnowledgeStatus();
    } finally {
      setIsSyncingKnowledge(false);
    }
  };

  const appendToActiveChat = (message) => {
    if (hasReportContext) {
      setReportChatHistory((prev) => [...prev, message]);
    } else {
      setGlobalChatHistory((prev) => [...prev, message]);
    }
  };

  const handleAskQuestion = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;

    const userQuestion = question;
    appendToActiveChat({ role: 'user', content: userQuestion });
    setQuestion('');
    setIsQuerying(true);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/chat`, {
        question: userQuestion,
        reportId: hasReportContext ? selectedReportId : null,
      });

      const answer = response.data.answer;
      const shouldShowDisclaimer = Boolean(answer?.disclaimer) && !hasShownMedicalDisclaimer;
      appendToActiveChat({
        role: 'ai',
        content: formatAnswer(answer, { includeDisclaimer: shouldShowDisclaimer }),
      });
      if (shouldShowDisclaimer) setHasShownMedicalDisclaimer(true);

      if (hasReportContext && selectedReport) {
        await loadReports({ preserveSelection: true });
      }
    } catch (error) {
      console.error('Error asking AI:', error);
      if (error.response && error.response.status === 401) {
        handleLogout();
      } else {
        const fallback = "Sorry, I couldn't answer that right now.";
        const detail = getApiErrorMessage(error);
        appendToActiveChat({ role: 'ai', content: detail ? `${fallback} ${detail}` : fallback });
      }
    } finally {
      setIsQuerying(false);
    }
  };

  const placeholder =
    hasReportContext && selectedReport
      ? `Ask about ${getReportTitle(selectedReport)}...`
      : 'Ask about reports or medical concepts...';

  return (
    <div className="flex h-screen bg-[#FAFAFA] font-sans text-stone-800 overflow-hidden">
      <aside className="w-64 flex flex-col justify-between bg-white border-r border-stone-200 shadow-[2px_0_8px_-4px_rgba(0,0,0,0.05)] z-10">
        <div>
          <div className="h-20 flex items-center px-8 border-b border-stone-100">
            <Activity className="text-amber-900 mr-3" size={26} strokeWidth={2.5} />
            <h1 className="text-xl font-bold bg-gradient-to-r from-amber-900 to-amber-700 bg-clip-text text-transparent tracking-tight">
              MedInsight
            </h1>
          </div>
          <nav className="p-4 space-y-2 mt-4">
            <NavItem
              icon={<LayoutDashboard size={20} />}
              label="Dashboard"
              active={activeSection === 'dashboard'}
              onClick={() => setActiveSection('dashboard')}
            />
            <NavItem
              icon={<FileText size={20} />}
              label="Patient Reports"
              active={activeSection === 'reports'}
              onClick={() => setActiveSection('reports')}
            />
            <NavItem
              icon={<MessageSquare size={20} />}
              label="Knowledge Base"
              active={activeSection === 'knowledge'}
              onClick={() => setActiveSection('knowledge')}
            />
          </nav>
        </div>
        <div className="p-4 border-t border-stone-100">
          <NavItem icon={<Settings size={20} />} label="Settings" />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all text-red-600 hover:bg-red-50 mt-2"
          >
            <LogOut size={20} /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen relative">
        <header className="h-20 flex items-center justify-between px-8 bg-white/80 backdrop-blur-md border-b border-stone-200 sticky top-0 z-10">
          <div className="relative w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search reports..."
              className="w-full pl-10 pr-4 py-2.5 bg-stone-100 border-none rounded-xl focus:ring-2 focus:ring-amber-900/20 outline-none"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-amber-900 p-0.5">
              <div className="w-full h-full bg-white rounded-full overflow-hidden">
                <img
                  src="https://api.dicebear.com/7.x/notionists/svg?seed=medinsight"
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-7xl mx-auto h-full flex flex-col xl:flex-row gap-8">
            <div className="w-full xl:w-[38%] flex flex-col gap-6">
              {activeSection === 'dashboard' && (
                <DashboardPanel
                  stats={dashboardStats}
                  reports={filteredReports}
                  selectedReport={selectedReport}
                  knowledgeStatus={knowledgeStatus}
                  onSelectReport={selectReport}
                  onOpenReports={() => setActiveSection('reports')}
                  onOpenKnowledge={() => setActiveSection('knowledge')}
                />
              )}

              {activeSection === 'reports' && (
                <ReportHistoryPanel
                  reports={filteredReports}
                  selectedReport={selectedReport}
                  isLoading={isLoadingReports}
                  onSelectReport={selectReport}
                  onRefreshReports={() => loadReports({ preserveSelection: true })}
                />
              )}

              {activeSection === 'knowledge' && (
                <>
                  <UploadPanel
                    fileInputRef={fileInputRef}
                    isUploading={isUploading}
                    uploadStatus={uploadStatus}
                    onUpload={handleFileUpload}
                  />
                  <KnowledgeStatusCard
                    status={knowledgeStatus}
                    isRefreshing={isRefreshingKnowledge}
                    isSyncing={isSyncingKnowledge}
                    onRefresh={refreshKnowledgeStatus}
                    onSync={handleSyncKnowledgeBase}
                  />
                </>
              )}
            </div>

            <div className="w-full xl:flex-1 bg-white rounded-2xl shadow-sm border border-stone-200 flex flex-col overflow-hidden min-h-[720px]">
              <div className="p-5 border-b border-stone-100 bg-stone-50/50 flex flex-col gap-4">
                <div className="flex justify-between items-center gap-4">
                  <div>
                    <h2 className="text-base font-semibold text-stone-800">AI Assistant</h2>
                    <p className="text-xs text-stone-500 mt-1">
                      {hasReportContext && selectedReport
                        ? `Using ${getReportTitle(selectedReport)} with the indexed medical knowledge base`
                        : 'Using the indexed medical knowledge base'}
                    </p>
                  </div>
                  <div className="px-3 py-1 bg-white border border-stone-200 rounded-full text-xs font-medium text-stone-600 shadow-sm flex items-center gap-2">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>Gemini 3.1 Flash-Lite
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {activeChatHistory.map((msg, index) => (
                  <div key={`${msg.role}-${index}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[78%] whitespace-pre-line p-4 text-[15px] leading-relaxed shadow-sm ${
                        msg.role === 'user'
                          ? 'bg-amber-900 text-white rounded-2xl rounded-tr-sm'
                          : 'bg-white border border-stone-200 text-stone-700 rounded-2xl rounded-tl-sm'
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {isQuerying && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-stone-200 text-stone-500 rounded-2xl rounded-tl-sm p-4 shadow-sm flex items-center gap-3">
                      <Loader2 size={18} className="animate-spin text-amber-900" />
                      <span className="text-sm">Analyzing...</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="p-5 bg-white border-t border-stone-100">
                <form onSubmit={handleAskQuestion} className="relative flex items-center">
                  <input
                    type="text"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    disabled={isQuerying}
                    placeholder={placeholder}
                    className="w-full bg-stone-50 border border-stone-200 rounded-full py-3.5 pl-6 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-amber-900/30 shadow-inner"
                  />
                  <button
                    type="submit"
                    disabled={!question.trim() || isQuerying}
                    className={`absolute right-2 p-2 rounded-full flex items-center justify-center ${
                      question.trim() && !isQuerying ? 'bg-amber-900 text-white hover:bg-amber-950' : 'bg-stone-100 text-stone-400'
                    }`}
                  >
                    <Send size={18} className="translate-x-[-1px] translate-y-[1px]" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function DashboardPanel({ stats, reports, selectedReport, knowledgeStatus, onSelectReport, onOpenReports, onOpenKnowledge }) {
  const recentReports = reports.slice(0, 4);

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <StatCard icon={<ClipboardList size={20} />} label="Reports" value={stats.totalReports} />
        <StatCard icon={<History size={20} />} label="This month" value={stats.thisMonth} />
        <StatCard icon={<AlertCircle size={20} />} label="Need review" value={stats.reportsWithFindings} />
        <StatCard icon={<Database size={20} />} label="Knowledge" value={stats.knowledgeLabel} compact />
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-stone-800">Selected Report</h2>
            <p className="text-sm text-stone-500">Latest selected medical record.</p>
          </div>
          <Stethoscope size={22} className="text-amber-900" />
        </div>
        {selectedReport ? (
          <ReportSummary report={selectedReport} />
        ) : (
          <EmptyState icon={<FileSearch size={28} />} title="No report selected" text="Choose a report from history or upload one from Knowledge Base." />
        )}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-stone-800">Recent Reports</h2>
          <button onClick={onOpenReports} className="text-xs font-semibold text-amber-900 hover:text-amber-950">
            View all
          </button>
        </div>
        <div className="space-y-3">
          {recentReports.length > 0 ? (
            recentReports.map((report) => (
              <ReportListItem
                key={getReportId(report)}
                report={report}
                active={getReportId(report) === getReportId(selectedReport)}
                onClick={() => onSelectReport(report)}
              />
            ))
          ) : (
            <EmptyState icon={<FileText size={26} />} title="No reports yet" text="Upload your first report to start building patient history." />
          )}
        </div>
      </div>

      <KnowledgeStatusCard
        status={knowledgeStatus}
        isRefreshing={false}
        isSyncing={false}
        onRefresh={onOpenKnowledge}
        onSync={onOpenKnowledge}
        compactActions
      />
    </>
  );
}

function UploadPanel({ fileInputRef, isUploading, uploadStatus, onUpload }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 min-h-[420px] flex flex-col">
      <h2 className="text-base font-semibold text-stone-800 mb-1">Add Medical Record</h2>
      <p className="text-sm text-stone-500 mb-6">Upload PDFs to add a patient report.</p>
      <div
        className={`flex-1 border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-8 transition-all cursor-pointer group relative overflow-hidden ${
          uploadStatus === 'error'
            ? 'border-red-300 bg-red-50'
            : uploadStatus === 'success'
              ? 'border-green-300 bg-green-50'
              : 'border-stone-300 bg-stone-50 hover:bg-stone-100 hover:border-amber-900/30'
        }`}
      >
        <input
          type="file"
          ref={fileInputRef}
          className="absolute inset-0 opacity-0 cursor-pointer z-10 disabled:cursor-not-allowed"
          accept=".pdf"
          onChange={onUpload}
          disabled={isUploading}
        />
        {isUploading ? (
          <div className="flex flex-col items-center text-amber-900">
            <Loader2 size={36} className="animate-spin mb-4" />
            <span className="text-sm font-medium">Processing...</span>
          </div>
        ) : uploadStatus === 'success' ? (
          <div className="flex flex-col items-center text-green-700">
            <CheckCircle size={36} className="mb-4" />
            <span className="text-sm font-medium">Upload Complete!</span>
          </div>
        ) : (
          <>
            <div className="h-14 w-14 bg-white shadow-sm border border-stone-200 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <UploadCloud className="text-stone-500 group-hover:text-amber-900" size={28} />
            </div>
            <span className="text-sm font-medium text-stone-700">Drag & drop or click</span>
          </>
        )}
      </div>
    </div>
  );
}

function ReportHistoryPanel({ reports, selectedReport, isLoading, onSelectReport, onRefreshReports }) {
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-200 flex flex-col min-h-[720px]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-stone-800">Report History</h2>
          <p className="text-sm text-stone-500">Select a report to switch assistant context.</p>
        </div>
        <button
          type="button"
          onClick={onRefreshReports}
          className="h-9 w-9 rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 flex items-center justify-center"
          aria-label="Refresh reports"
        >
          {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
        </button>
      </div>
      <div className="space-y-3 overflow-y-auto pr-1">
        {reports.length > 0 ? (
          reports.map((report) => (
            <ReportListItem
              key={getReportId(report)}
              report={report}
              active={getReportId(report) === getReportId(selectedReport)}
              onClick={() => onSelectReport(report)}
            />
          ))
        ) : (
          <EmptyState icon={<FileText size={28} />} title="No matching reports" text="Try another search or upload a medical PDF." />
        )}
      </div>
      {selectedReport && (
        <div className="mt-5 border-t border-stone-100 pt-5">
          <ReportSummary report={selectedReport} detailed />
        </div>
      )}
    </div>
  );
}

function ReportListItem({ report, active, onClick }) {
  const abnormalValues = Array.isArray(report.abnormalValues) ? report.abnormalValues : [];
  const hasFindings = abnormalValues.length > 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-all ${
        active ? 'border-amber-900 bg-amber-50/60 shadow-sm' : 'border-stone-200 bg-white hover:bg-stone-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm text-stone-800 truncate">{getReportTitle(report)}</div>
          <div className="text-xs text-stone-500 mt-1 truncate">{getReportSubtitle(report)}</div>
          <div className="text-xs text-stone-400 mt-2">{formatDate(report.createdAt)}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {hasFindings && <span className="h-2 w-2 rounded-full bg-amber-500"></span>}
          <ChevronRight size={16} className={active ? 'text-amber-900' : 'text-stone-300'} />
        </div>
      </div>
    </button>
  );
}

function ReportSummary({ report, detailed = false }) {
  const parameters = Array.isArray(report.parameters) ? report.parameters.slice(0, detailed ? 8 : 4) : [];
  const questions = Array.isArray(report.suggestedQuestions) ? report.suggestedQuestions.slice(0, 3) : [];

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xl font-bold text-stone-900 truncate">{getReportTitle(report)}</h3>
          <p className="text-sm text-stone-500 mt-1">{formatDate(report.createdAt)}</p>
        </div>
        <FileText className="text-amber-900 shrink-0" size={24} />
      </div>
      {report.summary && <p className="text-sm text-stone-600 leading-relaxed mt-4">{report.summary}</p>}
      {parameters.length > 0 && (
        <div className="mt-5 space-y-2">
          {parameters.map((item, index) => (
            <div key={`${item.parameter}-${index}`} className="rounded-lg bg-stone-50 border border-stone-100 px-3 py-2">
              <div className="flex justify-between gap-3 text-sm">
                <span className="font-medium text-stone-700">{item.parameter || 'Parameter'}</span>
                <span className="text-stone-600">{item.value || '-'}</span>
              </div>
              {(item.referenceRange || item.status) && (
                <div className="text-xs text-stone-400 mt-1">
                  {item.referenceRange ? `Range: ${item.referenceRange}` : ''}
                  {item.referenceRange && item.status ? ' · ' : ''}
                  {item.status || ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {questions.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-stone-400 mb-2">Suggested questions</h4>
          <div className="space-y-2">
            {questions.map((item, index) => (
              <div key={`${item}-${index}`} className="text-sm text-stone-600 rounded-lg bg-stone-50 border border-stone-100 px-3 py-2">
                {item}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function KnowledgeStatusCard({ status, isRefreshing, isSyncing, onRefresh, onSync, compactActions = false }) {
  return (
    <div className="bg-gradient-to-br from-amber-900 to-amber-800 rounded-2xl p-6 text-white shadow-md relative overflow-hidden shrink-0">
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -translate-y-1/2 translate-x-1/3"></div>
      <div className="flex items-start justify-between gap-3 mb-4 relative z-10">
        <div>
          <h3 className="font-medium text-stone-200 mb-1">Knowledge Base Status</h3>
          <div className="text-3xl font-bold">{getKnowledgeReadinessLabel(status)}</div>
        </div>
        <Database size={24} className="text-amber-200 shrink-0" />
      </div>
      <div className="space-y-2 text-sm text-stone-100 relative z-10">
        <div className="flex items-center">
          <span className={`w-2 h-2 rounded-full mr-2 ${status?.ready ? 'bg-emerald-300 animate-pulse' : 'bg-amber-300'}`}></span>
          {status?.provider === 'pinecone' ? 'Vector knowledge base' : 'Local knowledge base'}
        </div>
        {status?.chunkCount !== null && status?.chunkCount !== undefined && (
          <div className="text-stone-200">Sources indexed: {status.chunkCount}</div>
        )}
        {status?.lastError && <div className="text-red-100 text-xs leading-relaxed">{status.lastError}</div>}
      </div>
      <div className="mt-5 flex gap-2 relative z-10">
        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing || isSyncing}
          className="flex items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-60"
        >
          {isRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {compactActions ? 'Open' : 'Refresh'}
        </button>
        <button
          type="button"
          onClick={onSync}
          disabled={isRefreshing || isSyncing}
          className="flex items-center justify-center gap-2 rounded-lg bg-white text-amber-950 px-3 py-2 text-xs font-semibold hover:bg-amber-50 disabled:opacity-60"
        >
          {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />}
          {compactActions ? 'Manage' : 'Sync'}
        </button>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, compact = false }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-stone-200">
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="h-10 w-10 rounded-xl bg-amber-50 text-amber-900 flex items-center justify-center">{icon}</span>
      </div>
      <div className={`${compact ? 'text-xl' : 'text-3xl'} font-bold text-stone-900 truncate`}>{value}</div>
      <div className="text-xs font-medium text-stone-500 mt-1">{label}</div>
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 p-6 text-center">
      <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-white border border-stone-200 text-stone-400 flex items-center justify-center">
        {icon}
      </div>
      <div className="font-semibold text-sm text-stone-700">{title}</div>
      <div className="text-sm text-stone-500 mt-1">{text}</div>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
        active ? 'bg-stone-100 border border-stone-200 text-amber-900' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-800'
      }`}
    >
      <span className={active ? 'text-amber-900' : 'text-stone-400'}>{icon}</span>
      {label}
    </button>
  );
}

export default App;
