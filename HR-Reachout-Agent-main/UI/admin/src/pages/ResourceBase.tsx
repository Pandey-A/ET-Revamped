import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import MainLayout from '@/components/Layout/MainLayout';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Search, Upload, FileText, FilePlus, FileCode , Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from '@/components/ui/sonner';
import axios from 'axios';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl
} from '@/components/ui/form';
import { useForm } from 'react-hook-form';
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent
} from '@/components/ui/tabs';

interface UploadedDocument {
  id: string;
  name: string;
  type: string;
  size?: number;
  dateUploaded: Date;
  url?: string;
  agentName: string;
}

const ResourceBase = () => {
  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [openUploadDialog, setOpenUploadDialog] = useState(false);
  const [uploadType, setUploadType] = useState<'file' | 'link'>('file');
  const [linkInput, setLinkInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [agentName, setAgentName] = useState({ name: '', id: '' });
  const { agentName: urlAgentName } = useParams<{ agentName?: string }>();
  const [agentFilter, setAgentFilter] = useState<string>('');
  const form = useForm();
  const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('resourceDocuments');
    if (stored) {
      const parsed = JSON.parse(stored) as UploadedDocument[];
      console.log('Loaded documents from localStorage:', parsed);
      setDocuments(parsed.map(doc => ({ ...doc, dateUploaded: new Date(doc.dateUploaded) })));
    }

    const storedAgents = localStorage.getItem('agents');
    if (storedAgents) {
      try {
        const parsed = JSON.parse(storedAgents);
        console.log('Loaded agents from localStorage:', parsed);
        if (Array.isArray(parsed)) {
          setAgents(parsed); // Assuming agents have { id, name, description }
        }
      } catch (err) {
        console.error('Failed to parse agents:', err);
    }
  }

  }, []);

  useEffect(() => {
    if (urlAgentName) {
      setAgentFilter(urlAgentName);
    }
  }, [urlAgentName]);

  const updateLocalStorage = (docs: UploadedDocument[]) => {
    localStorage.setItem('resourceDocuments', JSON.stringify(docs));
  };

const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
  const files = event.target.files;
  if (!files || files.length === 0) return;

  setSelectedFile(files[0]); // store selected file temporarily
};


  // const submitFileUpload = () => {
  //   if (!selectedFile) {
  //     toast.error('Please select a file first');
  //     return;
  //   }

  //   if (!agentName.trim()) {
  //     toast.error('Please select an agent');
  //     return;
  //   }

  //   if (
  //     selectedFile.type !== 'application/pdf' &&
  //     selectedFile.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  //   ) {
  //     toast.error('Only PDF and DOCX files are supported');
  //     return;
  //   }

  //   const newDocument: UploadedDocument = {
  //     id: Date.now().toString(),
  //     name: selectedFile.name,
  //     type: selectedFile.type,
  //     size: selectedFile.size,
  //     dateUploaded: new Date(),
  //     agentName: agentName.trim(),
  //     url: URL.createObjectURL(selectedFile)
  //   };

  //   const updatedDocs = [newDocument, ...documents];
  //   setDocuments(updatedDocs);
  //   updateLocalStorage(updatedDocs);
  //   toast.success(`${selectedFile.name} uploaded successfully`);
  //   setAgentName('');
  //   setSelectedFile(null);
  //   setOpenUploadDialog(false);
  // };

const submitFileUpload = async () => {
  if (!selectedFile) {
    toast.error('Please select a file first');
    return;
  }

  if (!agentName.name.trim()) {
    toast.error('Please select an agent');
    return;
  }

  if (
    selectedFile.type !== 'application/pdf' &&
    selectedFile.type !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    toast.error('Only PDF and DOCX files are supported');
    return;
  }

  const formData = new FormData();
  formData.append("file", selectedFile);
  formData.append("collection_name", agentName.name.trim());
  formData.append('agent_id', agentName.id.trim());

  setUploading(true);
  try {
    const res = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/index/pdf`, formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    if (res.data.status === "success") {
      toast.success(`${selectedFile.name} indexed and uploaded successfully`);

      const newDocument: UploadedDocument = {
        id: Date.now().toString(),
        name: selectedFile.name,
        type: selectedFile.type,
        size: selectedFile.size,
        dateUploaded: new Date(),
        agentName: agentName.name.trim(),
        // url: URL.createObjectURL(selectedFile), 
          url: res.data.url,  
      };

      const updatedDocs = [newDocument, ...documents];
      setDocuments(updatedDocs);
      updateLocalStorage(updatedDocs);
    } else {
      toast.error("Error indexing file");
    }
  } catch (err: any) {
    console.error(err);
    toast.error(err?.response?.data?.error || "Unexpected error");
  } finally {
    setUploading(false);
    setAgentName({ name: '', id: '' });
    setSelectedFile(null);
    setOpenUploadDialog(false);
  }
};


const handleLinkUpload = async () => {
  if (!linkInput.trim()) {
    toast.error('Please enter a valid link');
    return;
  }

  if (!agentName.name.trim()) {
    toast.error('Please select an agent');
    return;
  }

  setUploading(true);
  try {
    const res = await axios.post(`${import.meta.env.VITE_BACKEND_URL}/index/url`, {
      url: linkInput,
      collection_name: agentName.name.trim(),
      agent_id : agentName.id.trim()
    });

    if (res.status === 200 && res.data.status === "success") {
      toast.success("URL indexed and embeddings uploaded.");

      const newLink: UploadedDocument = {
        id: Date.now().toString(),
        name: linkInput,
        type: 'link',
        url: linkInput,
        dateUploaded: new Date(),
        agentName: agentName.name.trim()
      };

      const updatedDocs = [newLink, ...documents];
      setDocuments(updatedDocs);
      updateLocalStorage(updatedDocs);

      setAgentName({name:'',id:''});
      setLinkInput('');
      setOpenUploadDialog(false);
    } else {
      toast.error("Error indexing URL");
    }
  } catch (err: any) {
    console.error(err);
    toast.error(`Error: ${err?.response?.data?.error || 'Unknown error'}`);
  }finally {
    setUploading(false);
  }
};


  const getFileIcon = (fileType: string) => {
    if (fileType === 'application/pdf') return <FileText className="h-6 w-6 text-red-500" />;
    if (fileType === 'link') return <FileCode className="h-6 w-6 text-green-500" />;
    return <FileCode className="h-6 w-6 text-blue-500" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} bytes`;
    else if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const filteredDocuments = documents
    .filter(doc =>
      doc.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      (!agentFilter || doc.agentName.toLowerCase().includes(agentFilter.toLowerCase()))
    )
    .sort((a, b) => b.dateUploaded.getTime() - a.dateUploaded.getTime());

  return (
    <MainLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Resource Base</h1>
        <p className="text-muted-foreground">Upload and access resources for common gaming issues</p>
      </div>

      <div className="flex flex-col sm:flex-row justify-between mb-6 gap-4">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            placeholder="Search documents..."
            className="pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <Dialog open={openUploadDialog} onOpenChange={setOpenUploadDialog}>
          <DialogTrigger asChild>
            <Button className="bg-primary flex items-center gap-2">
              <Upload size={18} />
              <span>Upload Resource</span>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Upload Resource</DialogTitle>
              <DialogDescription>Upload PDF and DOCX files to the knowledge base.</DialogDescription>
            </DialogHeader>

            <Tabs defaultValue="file" value={uploadType} onValueChange={(val) => setUploadType(val as 'file' | 'link')}>
              <TabsList className="mb-4">
                <TabsTrigger value="file">Upload File</TabsTrigger>
                <TabsTrigger value="link">Add Link</TabsTrigger>
              </TabsList>

              <TabsContent value="file">
                  {agents.length === 0 && (
                    <div className="text-red-500 text-sm mb-2">
                      No agents found. Please create an agent first.
                    </div>
                  )}
                <div className="space-y-2 mb-4">
                  <label className="text-sm font-medium">Agent Name</label>
                  {/* <Input
                    placeholder="e.g. SupportBot, Troubleshooter AI"
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                  /> */}
                  <select
                    className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    // value={agentName}
                    // onChange={(e) => setAgentName(e.target.value)}
                    value={agentName.id}
                    onChange={(e) => {
                      const selectedId = e.target.value;
                      const selectedAgent = agents.find(agent => agent.id === selectedId);
                  
                      if (selectedAgent) {
                        setAgentName({ name: selectedAgent.name, id: selectedAgent.id });
                        console.log("✅ Selected Agent:", selectedAgent);
                      } else {
                        console.warn("⚠️ Agent not found for ID:", selectedId);
                      }
                    }}
                  >
                    <option value="">Select an Agent</option>
                    {agents.map(agent => {
                  console.log("Rendering agent option:", agent);
                    return (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                      
                    )})}
                  </select>
                </div>
                <Form {...form}>
                  <FormItem>
                    <FormLabel>Select File</FormLabel>
                    <FormControl>
                      <Input
                        type="file"
                        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        onChange={handleFileUpload}
                      />
                    </FormControl>
                  </FormItem>
                </Form>
                <div className="text-xs text-muted-foreground mt-2">
                  Supported formats: PDF, DOCX
                </div>
                  <Button className="mt-4" onClick={submitFileUpload} disabled={uploading}>
                    {uploading ? (
                      <>
                        Uploading...
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      </>
                    ) : (
                      'Upload File'
                    )}
                  </Button>
              </TabsContent>

              <TabsContent value="link">
                  {agents.length === 0 && (
                    <div className="text-red-500 text-sm mb-2">
                      No agents found. Please create an agent first.
                    </div>
                  )}
                <div className="space-y-2">
                  <div className='flex flex-col gap-3 mb-2'>
                    <label className="text-sm font-medium">Agent Name</label>
                    {/* <Input
                      placeholder="e.g. SupportBot, Troubleshooter AI"
                      value={agentName}
                      onChange={(e) => setAgentName(e.target.value)}
                    /> */}
                    <select
                      className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                      value={agentName.id}
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        const selectedAgent = agents.find(agent => agent.id === selectedId);
                        if (selectedAgent) {
                          setAgentName({ name: selectedAgent.name, id: selectedAgent.id });
                          console.log("✅ Selected Agent:", selectedAgent);
                        } else {
                          console.warn("⚠️ Agent not found for ID:", selectedId);
                        }
                      }}
                    >
                      <option value="">Select an Agent</option>
                      {agents.map(agent => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className='py-2 flex flex-col gap-3'>
                  <label className="text-sm font-medium">Enter Resource Link</label>
                  <Input
                    placeholder="https://example.com/resource.pdf"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                  />
                  </div>
                    <Button className="mt-4" onClick={handleLinkUpload} disabled={uploading}>
                      {uploading ? (
                        <>
                          Uploading...
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        </>
                      ) : (
                        'Add Link'
                      )}
                    </Button>

                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex gap-2 items-center mb-4">
        <label className="text-sm font-medium">Filter by Agent:</label>
        <Input
          placeholder="Enter agent name (e.g. SupportBot)"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="w-64"
        />
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Uploaded Resources</CardTitle>
            <Badge variant="outline" className="bg-[#0a0a0a]/10">
              {documents.length} {documents.length === 1 ? 'document' : 'documents'}
            </Badge>
          </div>
          <CardDescription>View and access all uploaded resources</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[60vh]">
            {filteredDocuments.length > 0 ? (
              <div className="space-y-4">
                {filteredDocuments.map((doc) => (
                  <Card key={doc.id} className="bg-card/50 hover:border-primary/50 transition-all duration-200">
                    <CardContent className="p-4 flex items-center gap-4">
                      {getFileIcon(doc.type)}
                      <div className="flex-grow">
                        <h3 className="font-medium text-base">{doc.name}</h3>
                        <div className="flex gap-2 text-xs text-muted-foreground mt-1 flex-wrap">
                          <span>By: {doc.agentName || 'Unknown Agent'}</span>
                          {doc.size && (
                            <>
                              <span>•</span>
                              <span>{formatFileSize(doc.size)}</span>
                            </>
                          )}
                          <span>•</span>
                          <span>Uploaded {doc.dateUploaded.toLocaleDateString()}</span>
                        </div>
                      </div>
                      {doc.url && (
                        <Button variant="outline" size="sm" onClick={() => window.open(doc.url, '_blank')}>
                          <FileText size={16} className="mr-1" /> View
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <FilePlus className="mx-auto h-12 w-12 text-muted-foreground/60" />
                <h3 className="mt-4 text-lg font-medium">No resources yet</h3>
                <p className="text-muted-foreground mt-2">
                  {searchQuery || agentFilter
                    ? 'No resources match your search criteria'
                    : 'Upload resources to build your knowledge base'}
                </p>
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </MainLayout>
  );
};

export default ResourceBase;