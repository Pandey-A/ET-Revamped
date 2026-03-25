const getCurrentYear = () => new Date().getFullYear();

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-row">
        <span>&copy; {getCurrentYear()} ElevateTrust.Ai. All rights reserved.</span>
        <a
          href="https://elevatetrust.ai/privacy-policy"
          className="privacy-policy-url"
          target="_blank"
          rel="noopener noreferrer"
        >
          Privacy Policy
        </a>
      </div>
    </footer>
  );
};

export default Footer;
